import { createHash } from "node:crypto";
import type { AgentArtifact } from "../../../packages/domain/src/agent.ts";
import type { Connection } from "../../../packages/domain/src/index.ts";
import {
  type PlaidAccount,
  PlaidApiError,
  PlaidClient,
  type PlaidTransaction,
} from "../../../packages/integrations/src/plaid.ts";
import { decryptSecret, encryptSecret } from "../../../packages/integrations/src/vault.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";

interface PlaidCredential {
  id: "plaid";
  secret: string;
}
interface PlaidState {
  id: "state";
  institution: string | null;
  cursor: string;
  accounts: PlaidAccount[];
  transactions: PlaidTransaction[];
  syncedAt: string;
}
interface PendingLink {
  id: "pending";
  linkToken: string;
  expiresAt: string;
}
const MAX_TRANSACTIONS = 2000;
export const PLAID_ARTIFACT_ID = "plaid-finance";

/** Per-owner Plaid connection. Access tokens are stored only inside the encrypted vault envelope. */
export class PlaidService {
  private readonly client?: PlaidClient;
  constructor(
    private readonly db: Store,
    private readonly config: Config,
    client?: PlaidClient,
  ) {
    this.client = client ?? (config.plaid ? new PlaidClient(config.plaid) : undefined);
  }
  private requireClient() {
    if (!this.client) throw new AppError("Plaid is not configured on this server", 503);
    if (!this.config.encryptionKey)
      throw new AppError("TOKEN_ENCRYPTION_KEY is required to store bank connections", 503);
    return { client: this.client, key: this.config.encryptionKey };
  }
  async status(owner: string): Promise<Connection> {
    if (!this.client)
      return { id: "plaid", name: "Bank (Plaid)", status: "unconfigured", capabilities: [] };
    const state = await this.db.get<PlaidState>(owner, "plaid", "state");
    const credential = await this.db.get<PlaidCredential>(owner, "credentials", "plaid");
    return {
      id: "plaid",
      name: "Bank (Plaid)",
      status: credential ? "connected" : "disconnected",
      account: state?.institution ?? undefined,
      capabilities: credential ? ["Balances", "Transactions"] : [],
    };
  }
  async connect(owner: string) {
    const { client } = this.requireClient();
    const link = await this.call(() =>
      client.createLinkToken({
        userId: createHash("sha256").update(`plaid:${owner}`).digest("hex").slice(0, 32),
        clientName: "Noa on OpenMuse",
      }),
    );
    await this.db.put<PendingLink>(owner, "plaid", {
      id: "pending",
      linkToken: link.linkToken,
      expiresAt: link.expiresAt,
    });
    return { url: link.url };
  }
  /** Called after the person finishes Plaid's hosted Link page. */
  async complete(owner: string) {
    const { client } = this.requireClient();
    const pending = await this.db.get<PendingLink>(owner, "plaid", "pending");
    if (!pending) throw new AppError("Start connecting your bank first", 409);
    const [result] = await this.call(() => client.linkResults(pending.linkToken));
    if (!result)
      throw new AppError("Plaid hasn't finished linking yet. Complete it, then try again.", 409);
    await this.db.remove(owner, "plaid", "pending");
    return this.link(owner, result.publicToken, result.institution);
  }
  async link(owner: string, publicToken: string, institution: string | null) {
    const { client, key } = this.requireClient();
    const previous = await this.accessToken(owner);
    const exchanged = await this.call(() => client.exchangePublicToken(publicToken));
    await this.db.put<PlaidCredential>(owner, "credentials", {
      id: "plaid",
      secret: encryptSecret(JSON.stringify(exchanged), key),
    });
    if (previous) await client.removeItem(previous).catch(() => undefined);
    await this.db.remove(owner, "plaid", "state");
    return this.sync(owner, institution);
  }
  private async accessToken(owner: string) {
    const credential = await this.db.get<PlaidCredential>(owner, "credentials", "plaid");
    if (!credential || !this.config.encryptionKey) return null;
    return (
      JSON.parse(decryptSecret(credential.secret, this.config.encryptionKey)) as {
        accessToken: string;
      }
    ).accessToken;
  }
  async sync(owner: string, institution?: string | null) {
    const { client } = this.requireClient();
    const accessToken = await this.accessToken(owner);
    if (!accessToken) throw new AppError("Connect a bank first", 409);
    const previous = await this.db.get<PlaidState>(owner, "plaid", "state");
    const [accounts, changes] = await Promise.all([
      this.call(() => client.balances(accessToken)),
      this.call(() => client.syncTransactions(accessToken, previous?.cursor || undefined)),
    ]);
    const byId = new Map((previous?.transactions ?? []).map((t) => [t.id, t]));
    for (const t of [...changes.added, ...changes.modified]) byId.set(t.id, t);
    for (const id of changes.removed) byId.delete(id);
    const state: PlaidState = {
      id: "state",
      institution: institution ?? previous?.institution ?? null,
      cursor: changes.cursor,
      accounts,
      transactions: [...byId.values()]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, MAX_TRANSACTIONS),
      syncedAt: new Date().toISOString(),
    };
    await this.db.put(owner, "plaid", state);
    await this.db.put<AgentArtifact>(owner, "agent-artifacts", financeArtifact(state));
    return this.summary(state);
  }
  private summary(state: PlaidState) {
    return {
      institution: state.institution,
      accounts: state.accounts.length,
      transactions: state.transactions.length,
      syncedAt: state.syncedAt,
    };
  }
  /** Reads synced data, refreshing from Plaid when it is more than an hour old. */
  private async state(owner: string) {
    const state = await this.db.get<PlaidState>(owner, "plaid", "state");
    if (!state)
      throw new AppError("No bank is connected. Connect one in Apps > Bank (Plaid).", 409);
    if (Date.now() - Date.parse(state.syncedAt) > 60 * 60_000)
      await this.sync(owner).catch(() => undefined);
    return (await this.db.get<PlaidState>(owner, "plaid", "state")) ?? state;
  }
  async balances(owner: string) {
    const state = await this.state(owner);
    return { institution: state.institution, syncedAt: state.syncedAt, accounts: state.accounts };
  }
  async transactions(
    owner: string,
    options: { days?: number; accountId?: string; limit?: number },
  ) {
    const state = await this.state(owner);
    const since = new Date(Date.now() - (options.days ?? 30) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const transactions = state.transactions
      .filter((t) => t.date >= since && (!options.accountId || t.accountId === options.accountId))
      .slice(0, options.limit ?? 100);
    return {
      institution: state.institution,
      syncedAt: state.syncedAt,
      amountConvention: "Positive amounts are money out; negative amounts are money in.",
      transactions,
    };
  }
  async disconnect(owner: string) {
    const accessToken = await this.accessToken(owner);
    if (accessToken && this.client)
      await this.client.removeItem(accessToken).catch(() => undefined);
    await Promise.all([
      this.db.remove(owner, "credentials", "plaid"),
      this.db.remove(owner, "plaid", "state"),
      this.db.remove(owner, "plaid", "pending"),
      this.db.remove(owner, "agent-artifacts", PLAID_ARTIFACT_ID),
    ]);
    return { ok: true };
  }
  private async call<T>(request: () => Promise<T>) {
    try {
      return await request();
    } catch (error) {
      if (error instanceof PlaidApiError)
        throw new AppError(`Plaid: ${error.message}`, error.status >= 500 ? 502 : 400);
      throw error;
    }
  }
}

/** Shapes synced Plaid data like the CSV finance tracker so the existing Finance view renders it. */
export function financeArtifact(state: PlaidState): AgentArtifact {
  const posted = state.transactions.filter((t) => !t.pending);
  const cents = (value: number) => Math.round(value * 100);
  const spending = posted.filter((t) => t.amount > 0).reduce((n, t) => n + cents(t.amount), 0);
  const income = -posted.filter((t) => t.amount < 0).reduce((n, t) => n + cents(t.amount), 0);
  const grouped = new Map<string, number>();
  for (const t of posted)
    if (t.amount > 0) grouped.set(t.category, (grouped.get(t.category) ?? 0) + cents(t.amount));
  const dates = posted.map((t) => t.date).sort();
  return {
    id: PLAID_ARTIFACT_ID,
    taskId: "plaid",
    kind: "finance",
    title: state.institution ? `${state.institution} (Plaid)` : "Bank accounts (Plaid)",
    summary: `${state.accounts.length} accounts · ${posted.length} transactions · ${(spending / 100).toFixed(2)} spent`,
    data: {
      income: income / 100,
      spending: spending / 100,
      saved: (income - spending) / 100,
      count: posted.length,
      categories: [...grouped]
        .map(([name, value]) => ({ name, amount: value / 100 }))
        .sort((a, b) => b.amount - a.amount),
      transactions: posted.slice(0, 200).map(({ id, date, description, amount, category }) => ({
        id,
        date,
        description,
        amount,
        category,
      })),
      period: { from: dates[0], to: dates.at(-1) },
      accounts: state.accounts,
      syncedAt: state.syncedAt,
      amountConvention: "Positive expenses; negative income. Values use the account currency.",
    },
    createdAt: state.syncedAt,
  };
}
