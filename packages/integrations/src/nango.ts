import { createHash } from "node:crypto";

export type NangoFetch = typeof fetch;
export interface NangoConnection {
  connection_id: string;
  provider_config_key: string;
  tags?: Record<string, string> | null;
  end_user?: { id?: string; email?: string | null; display_name?: string | null } | null;
  created_at?: string;
}

/** Thin server-side Nango client. Provider tokens never leave Nango; we only proxy. */
export class NangoClient {
  private readonly secretKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: NangoFetch;

  constructor(secretKey: string, baseUrl = "https://api.nango.dev", fetchImpl: NangoFetch = fetch) {
    this.secretKey = secretKey;
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }

  /** Stable, non-reversible Nango end-user id derived from the signed-in owner. */
  static endUserId(owner: string) {
    return `noa-${createHash("sha256").update(`nango:${owner}`).digest("hex").slice(0, 40)}`;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    headers: Record<string, string> = {},
  ) {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        "Content-Type": "application/json",
        ...headers,
      },
    });
    const text = await res.text();
    const body = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) throw new NangoError(res.status, body);
    return body as T;
  }

  async integrations() {
    const body = await this.request<{ data: { unique_key: string; provider: string }[] }>(
      "/integrations",
    );
    return body.data;
  }

  async createConnectSession(
    owner: string,
    integration: string,
    displayName?: string,
    defaults?: { user_scopes?: string; connection_config?: { oauth_scopes_override?: string } },
  ) {
    const body = await this.request<{
      data: { token: string; expires_at: string; connect_link?: string };
    }>("/connect/sessions", {
      method: "POST",
      body: JSON.stringify({
        tags: { end_user_id: NangoClient.endUserId(owner) },
        end_user: {
          id: NangoClient.endUserId(owner),
          ...(displayName ? { display_name: displayName } : {}),
        },
        allowed_integrations: [integration],
        ...(defaults ? { integrations_config_defaults: { [integration]: defaults } } : {}),
      }),
    });
    return body.data;
  }

  /** Direct OAuth start URL: opens the provider in the same tab, so it works from a phone browser. */
  oauthConnectUrl(integration: string, sessionToken: string) {
    return `${this.baseUrl}/oauth/connect/${encodeURIComponent(integration)}?connect_session_token=${encodeURIComponent(sessionToken)}`;
  }

  /** All connections Nango holds for this owner (filtered by our derived end-user id). */
  async connections(owner: string) {
    const endUserId = NangoClient.endUserId(owner);
    const body = await this.request<{ connections: NangoConnection[] }>(
      `/connections?endUserId=${encodeURIComponent(endUserId)}`,
    );
    // Never trust the server-side filter alone: keep only connections labelled with this owner.
    return (body.connections ?? []).filter(
      (c) => c.tags?.end_user_id === endUserId || c.end_user?.id === endUserId,
    );
  }

  async connectionConfig(connectionId: string, integration: string) {
    const body = await this.request<{ connection_config?: Record<string, unknown> }>(
      `/connection/${encodeURIComponent(connectionId)}?provider_config_key=${encodeURIComponent(integration)}`,
    );
    return body.connection_config ?? {};
  }

  async deleteConnection(connectionId: string, integration: string) {
    await this.request(
      `/connection/${encodeURIComponent(connectionId)}?provider_config_key=${encodeURIComponent(integration)}`,
      { method: "DELETE" },
    );
  }

  async proxy<T>(
    connectionId: string,
    integration: string,
    path: string,
    init: {
      method?: string;
      body?: unknown;
      query?: Record<string, string | number | undefined>;
    } = {},
  ) {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(init.query ?? {}))
      if (v !== undefined) query.set(k, String(v));
    const qs = query.size ? `?${query}` : "";
    return this.request<T>(
      `/proxy/${path.replace(/^\//, "")}${qs}`,
      {
        method: init.method ?? "GET",
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      },
      { "Connection-Id": connectionId, "Provider-Config-Key": integration },
    );
  }
}

export class NangoError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`Nango request failed (${status})`);
    this.status = status;
    this.body = body;
  }
  /** Free plan connection cap or similar plan limit. */
  get isLimit() {
    const text = JSON.stringify(this.body ?? "").toLowerCase();
    return this.status === 402 || /limit|quota|maximum number of connections/.test(text);
  }
}
