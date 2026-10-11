import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright";
import {
  capturePdfDownload,
  MAX_DOWNLOAD_BYTES,
  type PdfDownload,
  readDownloadFailures,
} from "./downloads.ts";
import { WorkerError } from "./errors.ts";
import { validatePublicUrl } from "./network.ts";
import { startEgressProxy } from "./proxy.ts";

export interface Session {
  id: string;
  title: string;
  url: string;
  status: "active" | "closed" | "error";
  updatedAt: string;
}
type Running = {
  context: BrowserContext;
  page: Page;
  touched: number;
  pending: Set<Promise<void>>;
  downloadError?: boolean;
};
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateSessionId(id: unknown): string {
  if (typeof id !== "string" || !SESSION_ID.test(id))
    throw new WorkerError("INVALID_SESSION", "A valid UUID session ID is required.");
  return id.toLowerCase();
}

const RISKY_ACTION =
  /\b(send|post|publish|submit|pay|purchase|buy|checkout|order|book|reserve|delete|remove|unsubscribe|transfer|confirm|reply|apply|save|update|settings)\b/i;
const SENSITIVE_FIELD =
  /pass|otp|one.?time|2fa|mfa|verification|security code|cvc|cvv|card|ssn|social security|\bpin\b/i;
const CARD_NUMBER = /\b(?:\d[ -]?){13,19}\b/;
const BLOCKED_PAGE =
  /captcha|verify (that )?you are (a )?human|are you a robot|unusual traffic|security check|access denied|automated (queries|access)|checking your browser|press (and|&) hold/i;
const CHALLENGE_FRAME =
  /recaptcha|hcaptcha|challenges\.cloudflare|turnstile|arkoselabs|funcaptcha/i;
export type BrowserAction =
  | { type: "click"; target: string; reviewed?: boolean }
  | { type: "type"; field: string; text: string }
  | { type: "press"; key: "Enter"; reviewed?: boolean }
  | { type: "scroll"; direction: "up" | "down" }
  | { type: "back" }
  | { type: "read" };

export function parseBrowserAction(value: Record<string, unknown>): BrowserAction {
  const text = (key: string, max: number) => {
    const item = value[key];
    if (typeof item !== "string" || !item.trim() || item.length > max)
      throw new WorkerError("INVALID_INPUT", `A ${key} of at most ${max} characters is required.`);
    return item;
  };
  const reviewed = value.reviewed === true;
  if (value.type === "click") return { type: "click", target: text("target", 200), reviewed };
  if (value.type === "type")
    return { type: "type", field: text("field", 200), text: text("text", 2000) };
  if (value.type === "press" && value.key === "Enter")
    return { type: "press", key: "Enter", reviewed };
  if (value.type === "scroll" && (value.direction === "up" || value.direction === "down"))
    return { type: "scroll", direction: value.direction };
  if (value.type === "back" || value.type === "read") return { type: value.type };
  throw new WorkerError("INVALID_INPUT", "Unsupported browser action.");
}

export async function createBrowserManager(
  options: {
    dataDir: string;
    maxSessions?: number;
    idleTimeoutMs?: number;
  },
  createProxy = startEgressProxy,
) {
  const { dataDir, maxSessions = 3, idleTimeoutMs = 30 * 60_000 } = options;
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const sessions = new Map<string, Session>();
  const running = new Map<string, Running>();
  const queues = new Map<string, Promise<unknown>>();
  const proxy = await createProxy();
  for (const id of await readdir(dataDir)) {
    if (!SESSION_ID.test(id)) continue;
    try {
      const stored = JSON.parse(
        await readFile(join(dataDir, id, "session.json"), "utf8"),
      ) as Session;
      sessions.set(id, { ...stored, id, status: "closed" });
    } catch {
      /* An incomplete first launch has no session metadata to restore. */
    }
    if (sessions.has(id)) await readDownloadFailures(join(dataDir, id), true);
  }
  const directory = (id: string) => join(dataDir, validateSessionId(id));
  async function persist(session: Session) {
    const path = join(directory(session.id), "session.json");
    await writeFile(`${path}.tmp`, JSON.stringify(session), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  }
  async function serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = queues.get(id) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    queues.set(id, next);
    try {
      return await next;
    } finally {
      if (queues.get(id) === next) queues.delete(id);
    }
  }
  function active(id: string) {
    const value = running.get(id);
    if (!value || value.page.isClosed())
      throw new WorkerError(
        "SESSION_CLOSED",
        "Open this browser session before using its console.",
        409,
      );
    value.touched = Date.now();
    return value;
  }
  async function refresh(id: string) {
    const instance = active(id);
    if (instance.page.url() !== "about:blank") await validatePublicUrl(instance.page.url());
    const session: Session = {
      id,
      title: (await instance.page.title()).slice(0, 300),
      url: instance.page.url(),
      status: "active",
      updatedAt: new Date().toISOString(),
    };
    sessions.set(id, session);
    await persist(session);
    return session;
  }
  async function downloads(id: string): Promise<PdfDownload[]> {
    if (!sessions.has(id))
      throw new WorkerError("SESSION_NOT_FOUND", "Browser session not found.", 404);
    const folder = join(directory(id), "downloads");
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const list: PdfDownload[] = [];
    for (const name of await readdir(folder)) {
      if (!name.endsWith(".json")) continue;
      const item = JSON.parse(await readFile(join(folder, name), "utf8")) as PdfDownload;
      list.push(item);
    }
    return list;
  }
  async function navigate(id: string, url: string) {
    const target = await validatePublicUrl(url);
    const { page } = active(id);
    try {
      await page.goto(target.url.href, { waitUntil: "domcontentloaded", timeout: 20_000 });
      // Chromium can follow redirects outside Playwright's initial route hook.
      // The proxy blocks those sockets, but its 403 is still an HTTP response:
      // validate the final location so the API does not report it as success.
      await validatePublicUrl(page.url());
    } catch (error) {
      if (error instanceof WorkerError && error.code === "BLOCKED_URL") {
        await page.goto("about:blank", { timeout: 5000 });
      }
      // A successful attachment intentionally aborts page navigation.
      if (!(error instanceof Error && /Download is starting/.test(error.message))) {
        throw new WorkerError(
          "NAVIGATION_FAILED",
          "The page could not be loaded. It may be unreachable or contain a blocked destination.",
          502,
        );
      }
    }
    return refresh(id);
  }
  async function closeSession(id: string) {
    const instance = running.get(id);
    const stored = sessions.get(id);
    if (!stored) throw new WorkerError("SESSION_NOT_FOUND", "Browser session not found.", 404);
    if (instance) {
      try {
        await instance.context.storageState({ path: join(directory(id), "storage.json") });
      } catch {
        // Cookie persistence is best-effort during teardown. A crashed or
        // unreachable browser must still release its context and session slot.
      }
      await instance.context.close().catch(() => {});
      await Promise.allSettled(instance.pending);
      running.delete(id);
    }
    const result: Session = { ...stored, status: "closed", updatedAt: new Date().toISOString() };
    sessions.set(id, result);
    await persist(result);
    return result;
  }
  async function createSession(id: string, url: string) {
    await validatePublicUrl(url);
    if (running.has(id)) return navigate(id, url);
    if (running.size >= maxSessions)
      throw new WorkerError(
        "SESSION_LIMIT",
        `Close an active session before opening another (limit ${maxSessions}).`,
        409,
      );
    if (!sessions.has(id) && sessions.size >= 20)
      throw new WorkerError(
        "PROFILE_LIMIT",
        "The worker has reached its 20 saved-profile limit.",
        409,
      );
    const previous = sessions.get(id);
    const profileDir = join(directory(id), "profile");
    const tempDirectory = join("/tmp", `openmuse-downloads-${id}`);
    await mkdir(profileDir, { recursive: true, mode: 0o700 });
    await mkdir(tempDirectory, { recursive: true, mode: 0o700 });
    // Never let Chromium save passwords, card numbers or form entries typed in Take control.
    await mkdir(join(profileDir, "Default"), { recursive: true, mode: 0o700 });
    const preferencesPath = join(profileDir, "Default", "Preferences");
    let preferences: Record<string, unknown> = {};
    try {
      preferences = JSON.parse(await readFile(preferencesPath, "utf8"));
    } catch {
      /* A new profile has no preferences yet. */
    }
    await writeFile(
      preferencesPath,
      JSON.stringify({
        ...preferences,
        credentials_enable_service: false,
        profile: {
          ...(preferences.profile as Record<string, unknown> | undefined),
          password_manager_enabled: false,
        },
        autofill: { profile_enabled: false, credit_card_enabled: false, enabled: false },
      }),
      { mode: 0o600 },
    );
    let context: BrowserContext;
    try {
      const { chromium } = await import("playwright");
      context = await chromium.launchPersistentContext(profileDir, {
        // Chromium does not need the worker API credential in its environment.
        env: {
          HOME: process.env.HOME ?? "/tmp",
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          LANG: "C.UTF-8",
        },
        headless: true,
        viewport: { width: 1280, height: 800 },
        proxy: { server: proxy.url, bypass: "<-loopback>" },
        // Service-worker fetches skip context.route, but still go through the egress proxy
        // and the host-resolver rule, which block private destinations.
        serviceWorkers: "allow",
        acceptDownloads: true,
        downloadsPath: tempDirectory,
        timeout: 25_000,
        args: [
          "--disable-quic",
          "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
          "--disable-extensions",
          "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
        ],
      });
    } catch {
      if (!previous) await rm(directory(id), { recursive: true, force: true });
      await rm(tempDirectory, { recursive: true, force: true });
      throw new WorkerError(
        "BROWSER_UNAVAILABLE",
        "Chromium could not start. Rebuild the browser-worker image and check its resource limits.",
        503,
      );
    }
    try {
      const statePath = join(directory(id), "storage.json");
      try {
        const state = JSON.parse(await readFile(statePath, "utf8")) as Awaited<
          ReturnType<BrowserContext["storageState"]>
        >;
        await context.addCookies(state.cookies);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      }
      await context.route("**/*", async (route) => {
        try {
          await validatePublicUrl(route.request().url());
          await route.continue();
        } catch {
          await route.abort("blockedbyclient").catch(() => {});
        }
      });
      await context.routeWebSocket("**/*", async (socket) => {
        try {
          await validatePublicUrl(socket.url().replace(/^ws/, "http"));
          socket.connectToServer();
        } catch {
          await socket.close().catch(() => {});
        }
      });
      for (const old of context.pages()) await old.close();
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      const instance: Running = { context, page, touched: Date.now(), pending: new Set() };
      running.set(id, instance);
      context.on("page", (popup) => {
        void popup.close();
      });
      page.on("dialog", (dialog) => {
        void dialog.dismiss();
      });
      page.on("download", (download) => {
        const pending = downloads(id).then((saved) =>
          capturePdfDownload({
            directory: directory(id),
            tempDirectory,
            download,
            limitReached: saved.length + instance.pending.size > 20,
          }),
        );
        instance.pending.add(pending);
        void pending.then(
          () => instance.pending.delete(pending),
          () => {
            instance.downloadError = true;
            instance.pending.delete(pending);
          },
        );
      });
      const initial: Session = {
        id,
        title: previous?.title ?? "New session",
        url,
        status: "active",
        updatedAt: new Date().toISOString(),
      };
      sessions.set(id, initial);
      await persist(initial);
      return await navigate(id, url);
    } catch (error) {
      await context.close().catch(() => {});
      await Promise.allSettled(running.get(id)?.pending ?? []);
      running.delete(id);
      if (previous) {
        const failed: Session = {
          ...previous,
          url,
          status: "error",
          updatedAt: new Date().toISOString(),
        };
        sessions.set(id, failed);
        await persist(failed);
      } else {
        sessions.delete(id);
        await rm(directory(id), { recursive: true, force: true });
      }
      await rm(tempDirectory, { recursive: true, force: true });
      throw error;
    }
  }
  const sweeper = setInterval(() => {
    for (const [id, instance] of running)
      if (Date.now() - instance.touched > idleTimeoutMs) {
        void serial(id, () => closeSession(id)).catch(() => {});
      }
  }, 60_000);
  sweeper.unref();
  return {
    list: () => [...sessions.values()],
    create: (id: string, url: string) =>
      serial("create", () => serial(id, () => createSession(id, url))),
    navigate: (id: string, url: string) => serial(id, () => navigate(id, url)),
    closeSession: (id: string) => serial(id, () => closeSession(id)),
    screenshot: (id: string) =>
      serial(id, () => active(id).page.screenshot({ type: "png", timeout: 10_000 })),
    read: (id: string) =>
      serial(id, async () => {
        const { page } = active(id);
        await validatePublicUrl(page.url());
        // Evaluation is fixed by the worker; callers cannot inject JavaScript.
        const result = await page.evaluate(() => {
          const text = document.body?.innerText ?? "";
          return {
            url: location.href,
            title: document.title.slice(0, 300),
            text: text.slice(0, 100_000),
            truncated: text.length > 100_000,
          };
        });
        await validatePublicUrl(result.url);
        const session: Session = {
          id,
          url: result.url,
          title: result.title,
          status: "active",
          updatedAt: new Date().toISOString(),
        };
        sessions.set(id, session);
        await persist(session);
        return result;
      }),
    input: (id: string, input: Record<string, unknown>) =>
      serial(id, async () => {
        const { page } = active(id);
        const { type, x, y, key, text, deltaY } = input;
        if (
          type === "click" &&
          typeof x === "number" &&
          typeof y === "number" &&
          Number.isFinite(x) &&
          Number.isFinite(y) &&
          x >= 0 &&
          x < 1280 &&
          y >= 0 &&
          y < 800
        )
          await page.mouse.click(x, y);
        else if (type === "text" && typeof text === "string" && text.length <= 10_000)
          await page.keyboard.insertText(text);
        else if (
          type === "key" &&
          typeof key === "string" &&
          /^(Enter|Tab|Escape|Backspace|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Control\+a|Meta\+a|Shift\+Tab)$/.test(
            key,
          )
        )
          await page.keyboard.press(key);
        else if (
          type === "scroll" &&
          typeof deltaY === "number" &&
          Number.isFinite(deltaY) &&
          Math.abs(deltaY) <= 5000
        )
          await page.mouse.wheel(0, deltaY);
        else throw new WorkerError("INVALID_INPUT", "Unsupported browser input or coordinates.");
        return refresh(id);
      }),
    act: (id: string, raw: Record<string, unknown>) =>
      serial(id, async () => {
        const action = parseBrowserAction(raw);
        const { page } = active(id);
        if (page.url() !== "about:blank") await validatePublicUrl(page.url());
        const reviewRequired = (name: string) =>
          new WorkerError(
            "REVIEW_REQUIRED",
            `“${name.slice(0, 80)}” could send, submit or change something. Prepare a review card first.`,
            409,
          );
        if (action.type === "click") {
          const target = page
            .getByRole("button", { name: action.target })
            .or(page.getByRole("link", { name: action.target }))
            .or(page.getByText(action.target))
            .first();
          const info = await target
            .evaluate((element) => {
              const control = element as HTMLButtonElement;
              const form = control.closest("form");
              const name = (
                control.getAttribute("aria-label") ||
                control.textContent ||
                control.value ||
                ""
              ).trim();
              const submits =
                !!form &&
                (control.tagName === "BUTTON" || control.type === "submit") &&
                control.type !== "button";
              const search =
                !!form &&
                (form.getAttribute("role") === "search" ||
                  !!form.querySelector("input[type=search]"));
              return { name, submits: submits && !search };
            })
            .catch(() => {
              throw new WorkerError(
                "TARGET_NOT_FOUND",
                `Nothing labelled “${action.target}” is on the page.`,
                404,
              );
            });
          if (!action.reviewed && (RISKY_ACTION.test(info.name) || info.submits))
            throw reviewRequired(info.name || action.target);
          await target.click({ timeout: 10_000 });
        } else if (action.type === "type") {
          const field = page
            .getByLabel(action.field)
            .or(page.getByPlaceholder(action.field))
            .or(page.getByRole("textbox", { name: action.field }))
            .first();
          const info = await field
            .evaluate((element) => {
              const input = element as HTMLInputElement;
              return [
                input.type,
                input.autocomplete,
                input.name,
                input.id,
                input.getAttribute("aria-label") ?? "",
                input.placeholder ?? "",
                input.labels?.[0]?.textContent ?? "",
              ];
            })
            .catch(() => {
              throw new WorkerError(
                "TARGET_NOT_FOUND",
                `No field labelled “${action.field}” is on the page.`,
                404,
              );
            });
          const [type, autocomplete] = info;
          if (
            type === "password" ||
            /one-time-code|cc-|current-password|new-password/.test(autocomplete ?? "") ||
            SENSITIVE_FIELD.test(`${action.field} ${info.slice(2).join(" ")}`) ||
            CARD_NUMBER.test(action.text)
          )
            throw new WorkerError(
              "SENSITIVE_FIELD",
              "This field takes a password, code or card number. The user must type it in Take control.",
              422,
            );
          await field.fill(action.text, { timeout: 10_000 });
        } else if (action.type === "press") {
          const search = await page.evaluate(() => {
            const focused = document.activeElement as HTMLInputElement | null;
            if (!focused) return false;
            const label = `${focused.type} ${focused.getAttribute("role") ?? ""} ${focused.name} ${focused.placeholder ?? ""} ${focused.getAttribute("aria-label") ?? ""}`;
            return /search/i.test(label);
          });
          if (!search && !action.reviewed) throw reviewRequired("Enter");
          await page.keyboard.press("Enter");
        } else if (action.type === "scroll") {
          await page.mouse.wheel(0, action.direction === "down" ? 700 : -700);
        } else if (action.type === "back") {
          await page.goBack({ waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => null);
        }
        await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
        if (page.url() !== "about:blank") await validatePublicUrl(page.url());
        // A click or Enter can start a navigation after the action resolves; retry the
        // read once the new document exists instead of failing the action.
        const snapshot = () =>
          page.evaluate(() => {
            const visible = (element: Element) => {
              const box = element.getBoundingClientRect();
              return box.width > 0 && box.height > 0;
            };
            const controls = Array.from(
              document.querySelectorAll("a[href],button,input,textarea,select,[role=button]"),
            )
              .filter(visible)
              .slice(0, 80)
              .map((element) => {
                const input = element as HTMLInputElement;
                const label =
                  element.getAttribute("aria-label") ||
                  input.labels?.[0]?.textContent ||
                  input.placeholder ||
                  element.textContent ||
                  input.value ||
                  "";
                return `${element.tagName.toLowerCase()}${input.type ? `[${input.type}]` : ""}: ${label.trim().replace(/\s+/g, " ").slice(0, 80)}`;
              });
            const text = document.body?.innerText ?? "";
            return {
              url: location.href,
              title: document.title.slice(0, 300),
              text: text.slice(0, 30_000),
              truncated: text.length > 30_000,
              controls,
              signInRequired: Array.from(document.querySelectorAll("input[type=password]")).some(
                visible,
              ),
            };
          });
        let result: Awaited<ReturnType<typeof snapshot>> | undefined;
        for (let attempt = 0; !result; attempt++) {
          try {
            result = await snapshot();
          } catch (error) {
            if (
              attempt >= 4 ||
              !(error instanceof Error && /context was destroyed|navigat/i.test(error.message))
            )
              throw error;
            await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
          }
        }
        if (page.url() !== "about:blank") await validatePublicUrl(page.url());
        const blocked =
          BLOCKED_PAGE.test(`${result.title} ${result.text.slice(0, 5000)}`) ||
          page.frames().some((frame) => CHALLENGE_FRAME.test(frame.url()));
        await refresh(id);
        return { ...result, blocked };
      }),
    downloads: async (id: string) => {
      const saved = await downloads(id);
      if (running.get(id)?.downloadError)
        throw new WorkerError(
          "DOWNLOAD_STORE_FAILED",
          "A download outcome could not be saved. Check worker storage and try again.",
          500,
        );
      return { downloads: saved, failures: await readDownloadFailures(directory(id)) };
    },
    download: async (id: string, downloadId: string) => {
      validateSessionId(downloadId);
      const metadata = (await downloads(id)).find((item) => item.id === downloadId);
      if (!metadata) throw new WorkerError("DOWNLOAD_NOT_FOUND", "PDF download not found.", 404);
      const path = join(directory(id), "downloads", `${downloadId}.pdf`);
      const info = await stat(path);
      if (info.size > MAX_DOWNLOAD_BYTES)
        throw new WorkerError("DOWNLOAD_TOO_LARGE", "The PDF exceeds 10 MiB.", 413);
      return { metadata, bytes: await readFile(path) };
    },
    close: async () => {
      clearInterval(sweeper);
      await Promise.allSettled([...queues.values()]);
      await Promise.allSettled([...running.keys()].map(closeSession));
      await proxy.close();
    },
  };
}
