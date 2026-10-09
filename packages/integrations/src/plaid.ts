import { z } from "zod";

/**
 * Read-only Plaid client: Link, balances and transactions. It deliberately has no
 * Transfer, Payment Initiation, Auth or other money-movement endpoints.
 */
export type PlaidEnvironment = "sandbox" | "production";
const HOSTS: Record<PlaidEnvironment, string> = {
  sandbox: "https://sandbox.plaid.com",
  production: "https://production.plaid.com",
};

export class PlaidApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PlaidApiError";
  }
}

const accountSchema = z.object({
  account_id: z.string(),
  name: z.string(),
  official_name: z.string().nullish(),
  mask: z.string().nullish(),
  type: z.string(),
  subtype: z.string().nullish(),
  balances: z.object({
    available: z.number().nullish(),
    current: z.number().nullish(),
    limit: z.number().nullish(),
    iso_currency_code: z.string().nullish(),
    unofficial_currency_code: z.string().nullish(),
  }),
});
const transactionSchema = z.object({
  transaction_id: z.string(),
  account_id: z.string(),
  amount: z.number(),
  date: z.string(),
  name: z.string().nullish(),
  merchant_name: z.string().nullish(),
  pending: z.boolean().default(false),
  iso_currency_code: z.string().nullish(),
  unofficial_currency_code: z.string().nullish(),
  personal_finance_category: z.object({ primary: z.string() }).nullish(),
});

export interface PlaidAccount {
  id: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  available: number | null;
  current: number | null;
  limit: number | null;
  currency: string | null;
}
/** Plaid's convention, kept as-is: positive amounts are money out, negative are money in. */
export interface PlaidTransaction {
  id: string;
  accountId: string;
  date: string;
  description: string;
  amount: number;
  category: string;
  pending: boolean;
  currency: string | null;
}

const mapAccount = (a: z.infer<typeof accountSchema>): PlaidAccount => ({
  id: a.account_id,
  name: a.official_name || a.name,
  mask: a.mask ?? null,
  type: a.type,
  subtype: a.subtype ?? null,
  available: a.balances.available ?? null,
  current: a.balances.current ?? null,
  limit: a.balances.limit ?? null,
  currency: a.balances.iso_currency_code ?? a.balances.unofficial_currency_code ?? null,
});
const titleCase = (value: string) =>
  value
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
const mapTransaction = (t: z.infer<typeof transactionSchema>): PlaidTransaction => ({
  id: t.transaction_id,
  accountId: t.account_id,
  date: t.date,
  description: t.merchant_name || t.name || "Transaction",
  amount: t.amount,
  category: t.personal_finance_category
    ? titleCase(t.personal_finance_category.primary)
    : "Uncategorized",
  pending: t.pending,
  currency: t.iso_currency_code ?? t.unofficial_currency_code ?? null,
});

export class PlaidClient {
  private readonly fetcher: typeof fetch;
  private readonly host: string;
  constructor(
    private readonly options: {
      clientId: string;
      secret: string;
      environment: PlaidEnvironment;
      fetch?: typeof fetch;
    },
  ) {
    this.fetcher = options.fetch ?? fetch;
    this.host = HOSTS[options.environment];
  }

  private async request<T>(path: string, body: Record<string, unknown>, schema: z.ZodType<T>) {
    const response = await this.fetcher(`${this.host}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: this.options.clientId,
        secret: this.options.secret,
        ...body,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok)
      throw new PlaidApiError(
        response.status,
        String(payload.error_code ?? "PLAID_ERROR"),
        String(payload.display_message ?? payload.error_message ?? "Plaid request failed"),
      );
    return schema.parse(payload);
  }

  /** Hosted Link works the same from iOS and the web app, so no native Link SDK is needed. */
  createLinkToken(input: { userId: string; clientName: string; redirectUri?: string }) {
    return this.request(
      "/link/token/create",
      {
        user: { client_user_id: input.userId },
        client_name: input.clientName,
        products: ["transactions"],
        transactions: { days_requested: 90 },
        country_codes: ["US"],
        language: "en",
        hosted_link: input.redirectUri ? { completion_redirect_uri: input.redirectUri } : {},
      },
      z
        .object({
          link_token: z.string(),
          hosted_link_url: z.string().url(),
          expiration: z.string(),
        })
        .transform((r) => ({
          linkToken: r.link_token,
          url: r.hosted_link_url,
          expiresAt: r.expiration,
        })),
    );
  }
  /** Returns the public tokens of items linked in this Link session (empty until the user finishes). */
  async linkResults(linkToken: string) {
    const result = await this.request(
      "/link/token/get",
      { link_token: linkToken },
      z.object({
        link_sessions: z
          .array(
            z.object({
              results: z
                .object({
                  item_add_results: z
                    .array(
                      z.object({
                        public_token: z.string(),
                        institution: z.object({ name: z.string() }).nullish(),
                      }),
                    )
                    .default([]),
                })
                .nullish(),
            }),
          )
          .default([]),
      }),
    );
    return result.link_sessions.flatMap((session) =>
      (session.results?.item_add_results ?? []).map((item) => ({
        publicToken: item.public_token,
        institution: item.institution?.name ?? null,
      })),
    );
  }
  exchangePublicToken(publicToken: string) {
    return this.request(
      "/item/public_token/exchange",
      { public_token: publicToken },
      z
        .object({ access_token: z.string(), item_id: z.string() })
        .transform((r) => ({ accessToken: r.access_token, itemId: r.item_id })),
    );
  }
  async balances(accessToken: string) {
    const result = await this.request(
      "/accounts/balance/get",
      { access_token: accessToken },
      z.object({ accounts: z.array(accountSchema) }),
    );
    return result.accounts.map(mapAccount);
  }
  /** Pulls every page of /transactions/sync from the cursor (bounded to protect the server). */
  async syncTransactions(accessToken: string, cursor?: string) {
    const added: PlaidTransaction[] = [],
      modified: PlaidTransaction[] = [],
      removed: string[] = [];
    let next = cursor;
    for (let page = 0; page < 20; page++) {
      const result = await this.request(
        "/transactions/sync",
        { access_token: accessToken, count: 500, ...(next ? { cursor: next } : {}) },
        z.object({
          added: z.array(transactionSchema),
          modified: z.array(transactionSchema),
          removed: z.array(z.object({ transaction_id: z.string() })),
          next_cursor: z.string(),
          has_more: z.boolean(),
        }),
      );
      added.push(...result.added.map(mapTransaction));
      modified.push(...result.modified.map(mapTransaction));
      removed.push(...result.removed.map((r) => r.transaction_id));
      next = result.next_cursor;
      if (!result.has_more) break;
    }
    return { added, modified, removed, cursor: next ?? "" };
  }
  async removeItem(accessToken: string) {
    await this.request("/item/remove", { access_token: accessToken }, z.object({}).passthrough());
  }
}
