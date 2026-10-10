import type {
  Connection,
  EmailDraft,
  EventDraft,
  SlackMessageDraft,
} from "../../../packages/domain/src/index.ts";
import {
  NangoClient,
  type NangoConnection,
  NangoError,
} from "../../../packages/integrations/src/nango.ts";
import type { Config } from "./config.ts";
import { AppError } from "./errors.ts";

export type ConnectorId =
  | "outlook"
  | "slack"
  | "teams"
  | "jira"
  | "quickbooks"
  | "stripe"
  | "gusto";

export interface ConnectorSpec {
  id: ConnectorId;
  name: string;
  description: string;
  /** Nango catalog provider keys, in preference order. */
  providers: string[];
  capabilities: string[];
  /** Minimum scopes requested at connect time (enforced per Nango connect session). */
  scopes?: { user_scopes?: string; connection_config?: { oauth_scopes_override?: string } };
  /** Hidden until the provider approves production access (listed in NANGO_APPROVED_CONNECTORS). */
  needsProductionApproval?: boolean;
}

export const CONNECTORS: ConnectorSpec[] = [
  {
    id: "outlook",
    name: "Outlook",
    description: "Search and read mail, read your calendar",
    providers: ["outlook"],
    scopes: {
      connection_config: {
        oauth_scopes_override: "offline_access User.Read Mail.Read Mail.Send Calendars.ReadWrite",
      },
    },
    capabilities: ["Read mail", "Read calendar", "Reviewed send"],
  },
  {
    id: "slack",
    name: "Slack",
    description: "Search and read messages you can see",
    providers: ["slack"],
    scopes: {
      user_scopes:
        "search:read channels:history groups:history im:history mpim:history channels:read groups:read im:read mpim:read users:read chat:write",
    },
    capabilities: ["Search messages", "Reviewed send"],
  },
  {
    id: "teams",
    name: "Microsoft Teams",
    description: "Read your chats and channels",
    providers: ["microsoft-teams"],
    scopes: {
      connection_config: {
        oauth_scopes_override:
          "offline_access User.Read Chat.Read Team.ReadBasic.All Channel.ReadBasic.All ChannelMessage.Read.All",
      },
    },
    capabilities: ["Read chats", "Read channels"],
  },
  {
    id: "jira",
    name: "Jira",
    description: "Search and read issues",
    providers: ["jira"],
    scopes: {
      connection_config: { oauth_scopes_override: "read:jira-work read:jira-user offline_access" },
    },
    capabilities: ["Search issues", "Read issues"],
  },
  {
    id: "quickbooks",
    name: "QuickBooks",
    description: "Profit and loss, invoices, expenses, balances",
    providers: ["quickbooks", "quickbooks-sandbox"],
    needsProductionApproval: true,
    scopes: { connection_config: { oauth_scopes_override: "com.intuit.quickbooks.accounting" } },
    capabilities: ["Reports", "Invoices", "Expenses"],
  },
  {
    id: "stripe",
    name: "Stripe",
    description: "Balance, recent payments and payouts",
    providers: ["stripe-api-key"],
    capabilities: ["Balance", "Payments", "Payouts"],
  },
  {
    id: "gusto",
    name: "Gusto",
    description: "Payroll runs and pay stubs you can see",
    providers: ["gusto", "gusto-demo"],
    needsProductionApproval: true,
    capabilities: ["Payrolls", "Pay stubs"],
  },
];

export const NANGO_CAP_MESSAGE =
  "Noa has reached its limit of connected accounts for now. Ask Raz to free up a connection.";

export class ConnectorService {
  private readonly client?: NangoClient;
  private integrationCache?: { at: number; map: Map<ConnectorId, string> };

  private readonly approved: Set<string>;

  constructor(config: Config, client?: NangoClient) {
    this.approved = new Set(config.nango?.approvedConnectors ?? []);
    this.client =
      client ??
      (config.nango ? new NangoClient(config.nango.secretKey, config.nango.baseUrl) : undefined);
  }

  private requireClient() {
    if (!this.client) throw new AppError("Connectors are not configured on this server", 503);
    return this.client;
  }

  /** Connector -> Nango integration key, for connectors configured in Nango. */
  async configured(): Promise<Map<ConnectorId, string>> {
    if (!this.client) return new Map();
    if (this.integrationCache && Date.now() - this.integrationCache.at < 60_000)
      return this.integrationCache.map;
    const integrations = await this.client.integrations();
    const map = new Map<ConnectorId, string>();
    for (const spec of CONNECTORS) {
      if (spec.needsProductionApproval && !this.approved.has(spec.id)) continue;
      for (const provider of spec.providers) {
        const match = integrations.find((i) => i.provider === provider);
        if (match) {
          map.set(spec.id, match.unique_key);
          break;
        }
      }
    }
    this.integrationCache = { at: Date.now(), map };
    return map;
  }

  private spec(id: string) {
    const spec = CONNECTORS.find((c) => c.id === id);
    if (!spec) throw new AppError("Unknown connector", 404);
    return spec;
  }

  private async integration(id: string) {
    const spec = this.spec(id);
    const key = (await this.configured()).get(spec.id);
    if (!key) throw new AppError(`${spec.name} is not configured on this server`, 503);
    return { spec, key };
  }

  /** The owner's connection for a connector; ownership comes only from the server-side owner. */
  private async connection(owner: string, key: string): Promise<NangoConnection | undefined> {
    const all = await this.requireClient().connections(owner);
    return all.find((c) => c.provider_config_key === key);
  }

  async list(owner: string): Promise<Connection[]> {
    const configured = await this.configured().catch(() => new Map<ConnectorId, string>());
    if (!configured.size) return [];
    const all = await this.requireClient()
      .connections(owner)
      .catch(() => [] as NangoConnection[]);
    return CONNECTORS.filter((spec) => configured.has(spec.id)).map((spec) => {
      const conn = all.find((c) => c.provider_config_key === configured.get(spec.id));
      return {
        id: spec.id,
        name: spec.name,
        status: conn ? "connected" : "disconnected",
        account: conn?.end_user?.email ?? conn?.end_user?.display_name ?? undefined,
        capabilities: conn ? spec.capabilities : [],
      };
    });
  }

  async connect(owner: string, id: string, displayName?: string) {
    const { spec, key } = await this.integration(id);
    if (await this.connection(owner, key)) return { connected: true, url: null };
    try {
      const session = await this.requireClient().createConnectSession(
        owner,
        key,
        displayName,
        spec.scopes,
      );
      return {
        connected: false,
        url: session.connect_link ?? null,
        token: session.token,
        name: spec.name,
      };
    } catch (error) {
      if (error instanceof NangoError && error.isLimit) throw new AppError(NANGO_CAP_MESSAGE, 409);
      throw error;
    }
  }

  async disconnect(owner: string, id: string) {
    const { key } = await this.integration(id);
    const conn = await this.connection(owner, key);
    if (conn) await this.requireClient().deleteConnection(conn.connection_id, key);
    return { disconnected: true };
  }

  async disconnectAll(owner: string) {
    if (!this.client) return;
    for (const conn of await this.client.connections(owner))
      await this.client.deleteConnection(conn.connection_id, conn.provider_config_key);
  }

  async proxy<T>(
    owner: string,
    id: ConnectorId,
    path: string,
    init: {
      method?: string;
      body?: unknown;
      query?: Record<string, string | number | undefined>;
    } = {},
  ) {
    const { spec, key } = await this.integration(id);
    const conn = await this.connection(owner, key);
    if (!conn) throw new AppError(`${spec.name} is not connected. Connect it under Apps.`, 409);
    return this.requireClient().proxy<T>(conn.connection_id, key, path, init);
  }

  /** Provider metadata Nango captured at connect time (e.g. QuickBooks realmId). */
  async connectionConfig(owner: string, id: ConnectorId) {
    const { spec, key } = await this.integration(id);
    const conn = await this.connection(owner, key);
    if (!conn) throw new AppError(`${spec.name} is not connected. Connect it under Apps.`, 409);
    return this.requireClient().connectionConfig(conn.connection_id, key);
  }

  /** Current connection identity for reviewed actions (null when not connected/configured). */
  async account(owner: string, id: ConnectorId): Promise<{ id: string; account: string } | null> {
    const key = (await this.configured()).get(id);
    if (!key || !this.client) return null;
    const conn = await this.connection(owner, key);
    if (!conn) return null;
    return {
      id: conn.connection_id,
      account: conn.end_user?.email ?? conn.end_user?.display_name ?? this.spec(id).name,
    };
  }

  /** Executes only after the owner approved the review card. */
  async sendOutlookMail(owner: string, draft: EmailDraft) {
    const recipients = (list: string[]) => list.map((address) => ({ emailAddress: { address } }));
    await this.proxy(owner, "outlook", "/v1.0/me/sendMail", {
      method: "POST",
      body: {
        message: {
          subject: draft.subject,
          body: { contentType: "Text", content: draft.body },
          toRecipients: recipients(draft.to),
          ccRecipients: recipients(draft.cc),
          bccRecipients: recipients(draft.bcc),
        },
        saveToSentItems: true,
      },
    });
    return `outlook-mail:${Date.now()}`;
  }

  async createOutlookEvent(owner: string, draft: EventDraft) {
    const when = (value: string) =>
      draft.allDay
        ? { dateTime: `${value.slice(0, 10)}T00:00:00`, timeZone: draft.timeZone }
        : { dateTime: new Date(value).toISOString().replace(/Z$/, ""), timeZone: "UTC" };
    const event = await this.proxy<{ id?: string }>(owner, "outlook", "/v1.0/me/events", {
      method: "POST",
      body: {
        subject: draft.title,
        body: { contentType: "Text", content: draft.description },
        start: when(draft.start),
        end: when(draft.end),
        isAllDay: draft.allDay,
        location: { displayName: draft.location },
        attendees: draft.attendees.map((address) => ({
          emailAddress: { address },
          type: "required",
        })),
      },
    });
    return event?.id ?? `outlook-event:${Date.now()}`;
  }

  async sendSlackMessage(owner: string, draft: SlackMessageDraft) {
    const result = await this.proxy<{ ok: boolean; ts?: string; error?: string }>(
      owner,
      "slack",
      "chat.postMessage",
      {
        method: "POST",
        body: { channel: draft.channel, text: draft.text, thread_ts: draft.threadTs },
      },
    );
    if (!result?.ok)
      throw new AppError(`Slack refused the message: ${result?.error ?? "unknown"}`, 502);
    return result.ts ?? `slack:${Date.now()}`;
  }
}
