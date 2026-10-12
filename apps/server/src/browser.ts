import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { BrowserActionDraft, BrowserSession } from "../../../packages/domain/src/index.ts";
import type { Auth } from "./auth.ts";
import { browserConsole } from "./browser-console.ts";
import type { Config } from "./config.ts";
import type { Store } from "./db.ts";
import { AppError } from "./errors.ts";
import type { Files } from "./files.ts";

const sessionSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
  status: z.enum(["idle", "active", "closed", "error"]),
  updatedAt: z.string(),
});
const readSchema = z.object({
  url: z.string(),
  title: z.string().max(300),
  text: z.string().max(100_000),
  truncated: z.boolean(),
});
const failureSchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  message: z.string(),
  createdAt: z.string(),
});
const actSchema = z.object({
  url: z.string(),
  title: z.string(),
  text: z.string(),
  truncated: z.boolean(),
  controls: z.array(z.string()),
  signInRequired: z.boolean(),
  blocked: z.boolean(),
});
type ChatBrowser = { id: string; sessionId: string };
const OWNER_PROFILE = "owner-profile";
const HELP_TTL_MS = 60 * 60 * 1000;
type AgentHelp = { id: string; site: string; reason: string; askedAt: string; resolved: boolean };

const BROWSER_SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertSessionId(id: string): void {
  if (!BROWSER_SESSION_ID.test(id)) throw new AppError("Browser session not found", 404);
}

// The shared worker runs 3 sessions and keeps 20 profiles, split fairly across ~5 accounts.
export const MAX_ACTIVE_PER_OWNER = 2;
export const MAX_PROFILES_PER_OWNER = 4;
export class BrowserService {
  private readonly queues = new Map<string, Promise<unknown>>();
  private health?: { checkedAt: number; reachable: Promise<boolean> };
  constructor(
    private readonly db: Store,
    private readonly config: Config,
    private readonly auth: Auth,
    private readonly files: Files,
    private readonly now: () => number = Date.now,
  ) {}
  /** Whether the configured worker answers its health check, cached briefly for snapshots. */
  reachable(): Promise<boolean> {
    if (!this.config.workerUrl || !this.config.workerToken) return Promise.resolve(false);
    const now = this.now();
    if (this.health && now - this.health.checkedAt < 15_000) return this.health.reachable;
    const reachable = fetch(`${this.config.workerUrl}/health`, {
      signal: AbortSignal.timeout(2000),
    }).then(
      (response) => response.ok,
      () => false,
    );
    this.health = { checkedAt: now, reachable };
    return reachable;
  }
  private async serial<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(id) ?? Promise.resolve()).catch(() => {}).then(operation);
    this.queues.set(id, next);
    try {
      return await next;
    } finally {
      if (this.queues.get(id) === next) this.queues.delete(id);
    }
  }
  private async request(path: string, body?: unknown, signal?: AbortSignal) {
    signal?.throwIfAborted();
    if (!this.config.workerUrl || !this.config.workerToken)
      throw new AppError("Browser worker is not configured. Start it using the setup guide.", 503);
    let response: Response;
    try {
      response = await fetch(`${this.config.workerUrl}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${this.config.workerToken}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(45000)])
          : AbortSignal.timeout(45000),
      });
    } catch {
      signal?.throwIfAborted();
      throw new AppError(
        "Browser worker is unavailable. Check that its container is running.",
        503,
      );
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new AppError(
        typeof payload?.error?.message === "string"
          ? payload.error.message
          : "Browser request failed",
        502,
      );
    }
    return response;
  }
  async get(owner: string, id: string) {
    assertSessionId(id);
    const value = await this.db.get<BrowserSession>(owner, "browsers", id);
    if (!value) throw new AppError("Browser session not found", 404);
    return value;
  }
  decorate(owner: string, session: BrowserSession) {
    return {
      ...session,
      consoleUrl: this.auth.sign(owner, `/api/browsers/${session.id}/console`),
      previewUrl: this.auth.sign(owner, `/api/browsers/${session.id}/preview`),
    };
  }
  private async save(owner: string, payload: unknown, expectedId: string) {
    const session = sessionSchema.parse(payload);
    if (session.id !== expectedId)
      throw new AppError("Browser worker returned a different session", 502);
    await this.db.put(owner, "browsers", session);
    return this.decorate(owner, session);
  }
  async create(owner: string, url: string, signal?: AbortSignal) {
    const owned = await this.db.list<BrowserSession>(owner, "browsers");
    if (owned.filter((session) => session.status === "active").length >= MAX_ACTIVE_PER_OWNER)
      throw new AppError(
        `Close one of your active browser sessions before opening another (limit ${MAX_ACTIVE_PER_OWNER}).`,
        409,
      );
    if (owned.length >= MAX_PROFILES_PER_OWNER)
      throw new AppError(
        `You have ${MAX_PROFILES_PER_OWNER} saved browser profiles; reopen one of them instead.`,
        409,
      );
    const id = randomUUID();
    // Record ownership before calling the worker, including when its response is lost.
    await this.db.put(owner, "browsers", {
      id,
      url,
      title: "New browser session",
      status: "idle",
      updatedAt: new Date().toISOString(),
    });
    return this.reopen(owner, id, url, signal);
  }
  private async openOwned(owner: string, id: string, url?: string, signal?: AbortSignal) {
    const value = await this.get(owner, id);
    const target = url ?? value.url;
    try {
      const response = await this.request("/sessions", { id, url: target }, signal);
      return await this.save(owner, await response.json(), id);
    } catch (error) {
      signal?.throwIfAborted();
      await this.save(
        owner,
        { ...value, url: target, status: "error", updatedAt: new Date().toISOString() },
        id,
      );
      throw error;
    }
  }
  reopen(owner: string, id: string, url?: string, signal?: AbortSignal) {
    return this.serial(id, () => this.openOwned(owner, id, url, signal));
  }
  navigate(owner: string, id: string, url: string) {
    return this.reopen(owner, id, url);
  }
  private async readOwned(owner: string, id: string, signal?: AbortSignal) {
    const session = await this.get(owner, id);
    const result = readSchema.parse(
      await (
        await this.request(`/sessions/${encodeURIComponent(id)}/read`, undefined, signal)
      ).json(),
    );
    await this.save(
      owner,
      {
        ...session,
        url: result.url,
        title: result.title,
        status: "active",
        updatedAt: new Date().toISOString(),
      },
      id,
    );
    return result;
  }
  read(owner: string, id: string) {
    return this.serial(id, () => this.readOwned(owner, id));
  }
  async observe(owner: string, url: string, existingId?: string, signal?: AbortSignal) {
    const id = existingId ?? (await this.create(owner, url, signal)).id;
    return this.serial(id, async () => {
      signal?.throwIfAborted();
      if (existingId) await this.openOwned(owner, id, url, signal);
      signal?.throwIfAborted();
      return { sessionId: id, ...(await this.readOwned(owner, id, signal)) };
    });
  }
  /** One saved browser profile per owner, shared by every chat and task so a sign-in carries over. */
  async ownerSession(owner: string, url = "about:blank") {
    const association =
      (await this.db.get<ChatBrowser>(owner, "chat-browsers", OWNER_PROFILE)) ??
      (await this.db.insertIfAbsent(owner, "chat-browsers", {
        id: OWNER_PROFILE,
        sessionId: randomUUID(),
      })) ??
      (await this.db.get<ChatBrowser>(owner, "chat-browsers", OWNER_PROFILE));
    if (!association) throw new AppError("Could not reserve the browser session", 500);
    const id = association.sessionId;
    await this.db.insertIfAbsent(owner, "browsers", {
      id,
      url,
      title: "New browser session",
      status: "idle",
      updatedAt: new Date().toISOString(),
    });
    return id;
  }
  /** Marks that the agent is stuck and needs the person to take control of its browser. */
  async askForHelp(owner: string, site: string, reason: string) {
    await this.db.put<AgentHelp>(owner, "agent-help", {
      id: OWNER_PROFILE,
      site,
      reason,
      askedAt: new Date().toISOString(),
      resolved: false,
    });
  }
  async resolveHelp(owner: string) {
    const help = await this.db.get<AgentHelp>(owner, "agent-help", OWNER_PROFILE);
    if (help && !help.resolved)
      await this.db.put<AgentHelp>(owner, "agent-help", { ...help, resolved: true });
  }
  async pendingHelp(owner: string) {
    const help = await this.db.get<AgentHelp>(owner, "agent-help", OWNER_PROFILE);
    if (!help || help.resolved || Date.now() - Date.parse(help.askedAt) > HELP_TTL_MS)
      return undefined;
    return { site: help.site, reason: help.reason, askedAt: help.askedAt };
  }
  async observeForOwner(owner: string, url: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    // Persist the association before contacting the worker so failed/lost responses
    // and later turns keep using the same profile instead of exhausting its limit.
    const id = await this.ownerSession(owner, url);
    return this.serial(id, async () => {
      signal?.throwIfAborted();
      await this.openOwned(owner, id, url, signal);
      signal?.throwIfAborted();
      const page = await this.readOwned(owner, id, signal);
      signal?.throwIfAborted();
      return {
        sessionId: id,
        ...page,
        text: page.text.slice(0, 30_000),
        truncated: page.truncated || page.text.length > 30_000,
      };
    });
  }
  /** Runs one agent action on the owner's shared browser, reopening the saved profile if it idled out. */
  async act(owner: string, action: Record<string, unknown>, signal?: AbortSignal) {
    const id = await this.ownerSession(owner);
    return this.serial(id, async () => {
      const send = async () =>
        actSchema.parse(
          await (
            await this.request(`/sessions/${encodeURIComponent(id)}/act`, action, signal)
          ).json(),
        );
      let result: z.infer<typeof actSchema>;
      try {
        result = await send();
      } catch (error) {
        if (!(error instanceof AppError && /Open this browser session/.test(error.message)))
          throw error;
        await this.openOwned(owner, id, undefined, signal);
        result = await send();
      }
      return { sessionId: id, ...result };
    });
  }
  /** Runs a browser step the user approved on a review card, only on the page it was approved for. */
  async runReviewed(owner: string, draft: BrowserActionDraft) {
    const current = await this.act(owner, { type: "read" });
    const here = new URL(current.url);
    const approved = new URL(draft.url);
    if (here.origin !== approved.origin || here.pathname !== approved.pathname)
      throw new AppError(
        `The browser moved to a different page than the one you approved (${draft.site}). Ask Noa to prepare the step again.`,
        409,
      );
    const after = await this.act(owner, {
      type: draft.action,
      ...(draft.action === "click" ? { target: draft.target } : { key: "Enter" }),
      reviewed: true,
    });
    return `${draft.site} · ${draft.summary} · now at ${after.url}`;
  }
  /** Opens a page in the owner's shared browser and returns what the agent can see and do there. */
  async openForAgent(owner: string, url: string, signal?: AbortSignal) {
    const id = await this.ownerSession(owner, url);
    await this.serial(id, () => this.openOwned(owner, id, url, signal));
    return this.act(owner, { type: "read" }, signal);
  }
  async close(owner: string, id: string) {
    return this.serial(id, async () => {
      await this.get(owner, id);
      return this.save(
        owner,
        await (await this.request(`/sessions/${encodeURIComponent(id)}/close`, {})).json(),
        id,
      );
    });
  }
  async preview(owner: string, id: string) {
    await this.get(owner, id);
    return this.request(`/sessions/${encodeURIComponent(id)}/screenshot`);
  }
  async input(owner: string, id: string, value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new AppError("A JSON object is required for browser input", 422);
    return this.serial(id, async () => {
      await this.get(owner, id);
      const payload: unknown = await (
        await this.request(`/sessions/${encodeURIComponent(id)}/input`, value)
      ).json();
      const editable = z.object({ editable: z.literal(true) }).safeParse(payload).success;
      return { ...(await this.save(owner, payload, id)), editable };
    });
  }
  async imports(owner: string, id: string) {
    return this.serial(id, () => this.importsOwned(owner, id));
  }
  private async importsOwned(owner: string, id: string) {
    await this.get(owner, id);
    const { downloads, failures } = z
      .object({
        downloads: z.array(
          z.object({ id: z.string(), name: z.string(), size: z.number(), mimeType: z.string() }),
        ),
        failures: z.array(failureSchema),
      })
      .parse(await (await this.request(`/sessions/${encodeURIComponent(id)}/downloads`)).json());
    const saved = [];
    for (const download of downloads) {
      const existing = await this.db.get<{ fileId: string }>(
        owner,
        "browser-downloads",
        download.id,
      );
      if (existing) {
        saved.push(this.files.signed(owner, await this.files.get(owner, existing.fileId)));
        continue;
      }
      const response = await this.request(
        `/sessions/${encodeURIComponent(id)}/downloads/${encodeURIComponent(download.id)}`,
      );
      const file = await this.files.import(
        owner,
        download.name,
        new Uint8Array(await response.arrayBuffer()),
        `Browser · ${id}`,
      );
      await this.db.put(owner, "browser-downloads", { id: download.id, fileId: file.id });
      saved.push(file);
    }
    return { files: saved, failures };
  }
  console(owner: string, id: string) {
    return browserConsole(this.auth.sign(owner, `/api/browsers/${id}/preview`));
  }
}
