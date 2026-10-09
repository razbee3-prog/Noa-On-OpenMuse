# Noa on OpenMuse: architecture map

This is a map of the upstream OpenMuse code (MIT, [LICENSE](../LICENSE)) as of upstream commit `1ac68f3`. It is the baseline for the Noa changes: Postgres, Docker Compose on one droplet, Anthropic models, and later multi-user accounts. Every claim links to the file and lines it comes from. Line links point at this commit and will drift as the code changes.

Paths are relative to the repository root.

## 1. Process layout

| Process | Entry point | What it runs |
| --- | --- | --- |
| API | [apps/server/src/index.ts](../apps/server/src/index.ts#L6-L16) | Hono HTTP server, CopilotKit runtime, and (unless `TASK_WORKER_ENABLED=false`) the in-process task worker ([L13](../apps/server/src/index.ts#L13)). |
| Separate task worker (optional) | [apps/server/src/worker-entry.ts](../apps/server/src/worker-entry.ts#L5-L12) | Same app graph, only `agent.start()`. It requires `DATABASE_URL`, because PGlite cannot be shared between processes ([L6-L9](../apps/server/src/worker-entry.ts#L6-L9)). |
| Browser worker | [apps/worker/src/index.ts](../apps/worker/src/index.ts), [apps/worker/src/server.ts](../apps/worker/src/server.ts) | Playwright/Chromium HTTP service with persistent profiles. Bearer-token protected. |
| Linux computer | [apps/computer/Dockerfile](../apps/computer/Dockerfile) | Image the API starts on demand, one container per owner, through the Docker CLI ([apps/server/src/computer-backend.ts](../apps/server/src/computer-backend.ts#L220-L240)). |
| Web / mobile client | [apps/mobile/App.tsx](../apps/mobile/App.tsx#L69-L98) | Expo app (iOS, Android, web). It talks to the API at `EXPO_PUBLIC_API_URL` ([apps/mobile/src/api.ts](../apps/mobile/src/api.ts#L4-L7)). |

Deployment references in the repo: [render.yaml](../render.yaml) (API, static web, private browser worker) and [infra/compose.yaml](../infra/compose.yaml), which **only defines the browser worker**. There are no Dockerfiles for the API or the web export yet. Ticket 1 has to add them, plus Postgres and Caddy.

## 2. The agent loop

**Runtime.** `makeRuntime` builds a CopilotKit v2 `CopilotRuntime` with an `agents` factory, the `CopilotKitIntelligence` instance, telemetry properties and `identifyUser`, then wraps it with `createCopilotHonoHandler` at `/api/copilotkit` ([apps/server/src/agent.ts](../apps/server/src/agent.ts#L28-L70)). The Hono app forwards `/api/copilotkit/*` to it ([apps/server/src/app.ts](../apps/server/src/app.ts#L332-L349)). Passing `intelligence` makes the runtime use CopilotKit's Intelligence runner (see section 7).

**Which agent class.** The factory returns one agent, `default` ([agent.ts L37-L57](../apps/server/src/agent.ts#L37-L57)):

- `AGENT_BACKEND=model` (Noa's setting) or `sample`: `ConversationAgent`, OpenMuse's own subclass of AG-UI's `AbstractAgent` ([apps/server/src/engine/conversation.ts](../apps/server/src/engine/conversation.ts#L29-L43)). It is built per request with the owner resolved from the bearer token ([agent.ts L51-L56](../apps/server/src/agent.ts#L51-L56)).
- `AGENT_BACKEND=agui`: AG-UI `HttpAgent` pointed at `AGENT_URL` ([agent.ts L46-L50](../apps/server/src/agent.ts#L46-L50)). This path does not pass the owner to the remote agent.

`ConversationAgent.run` assembles the owner-scoped tools (calendar, `search_mail`, `read_mail`, `delegate_task`, `agent_status`, monitors, memories, browser, computer, and search) ([conversation.ts L149-L380](../apps/server/src/engine/conversation.ts#L149-L380)). It then hands off to `tanstackAgent(...)` with `maxSteps` 6, or 16 for the E2B desktop, and the "You are OpenMuse…" system prompt ([conversation.ts L381-L390](../apps/server/src/engine/conversation.ts#L381-L390)).

`tanstackAgent` creates a **CopilotKit `BuiltInAgent` with `type: "tanstack"`**, a factory that calls `@tanstack/ai`'s `chat()` with an iteration limit (`maxIterations`) as the loop strategy ([apps/server/src/engine/tanstack-agent.ts](../apps/server/src/engine/tanstack-agent.ts#L113-L168)). So the model/tool loop is CopilotKit `BuiltInAgent` (TanStack factory mode), wrapped by `ConversationAgent`.

**Model selection.** `MODEL` is a `provider/model-id` string. `anthropic/...` maps to `anthropicText(id)` from `@tanstack/ai-anthropic`, with `ANTHROPIC_BASE_URL` and `MODEL_MAX_RETRIES` ([tanstack-agent.ts L25-L65](../apps/server/src/engine/tanstack-agent.ts#L25-L65), [apps/server/src/config.ts L97-L104](../apps/server/src/config.ts#L97-L104)). Chat counts as configured when `MODEL` and any provider key are set ([agent.ts L15-L27](../apps/server/src/agent.ts#L15-L27)).

**Delegated tasks** use a second loop. `AgentService.execute` dispatches each task kind and falls through to `executeModelTask` ([apps/server/src/engine/service.ts L794](../apps/server/src/engine/service.ts#L794), [L890](../apps/server/src/engine/service.ts#L890)). That function builds the task tools and calls the same `tanstackAgent` with `maxSteps: 16` and a task prompt ([apps/server/src/engine/model.ts L88](../apps/server/src/engine/model.ts#L88), [L326-L332](../apps/server/src/engine/model.ts#L326-L332)).

## 3. Task engine and SQL leases

All of the engine lives in [apps/server/src/engine/worker.ts](../apps/server/src/engine/worker.ts) and uses one SQL primitive, `Store.compareAndSwap`: `UPDATE records SET data = data || patch WHERE owner/kind/id AND data @> expected RETURNING data` ([apps/server/src/db.ts L69-L81](../apps/server/src/db.ts#L69-L81)).

- **Polling:** `setInterval` every 1 s (`pollMs`) ([worker.ts L47-L55](../apps/server/src/engine/worker.ts#L47-L55)). Each tick writes a global heartbeat row `system/worker-status/tasks` ([L68-L72](../apps/server/src/engine/worker.ts#L68-L72)), which the status endpoint reads ([service.ts L149](../apps/server/src/engine/service.ts#L149)).
- **Selection:** `scan("tasks")` loads every task of every owner. A task is due if it is `queued`, `scheduled` and past `nextRunAt`, `running` with an expired `leaseUntil`, or `waiting_approval` ([worker.ts L78-L86](../apps/server/src/engine/worker.ts#L78-L86)). At most **3 tasks in flight per worker process** ([L89](../apps/server/src/engine/worker.ts#L89)).
- **Claim:** CAS on `{status, leaseId[, leaseUntil]}` sets `status=running`, a new `leaseId`, `leaseUntil = now + 60 s` and `attempts+1` ([L124-L140](../apps/server/src/engine/worker.ts#L124-L140)). If another worker won the race, the CAS returns null and this one skips the task.
- **Heartbeat:** renews `leaseUntil` every `leaseMs/3`, and aborts the run if the CAS fails ([L174-L190](../apps/server/src/engine/worker.ts#L174-L190)).
- **Guard / checkpoint:** every progress write is a CAS on `{leaseId, status: running}`. Losing the lease throws `LostLeaseError` ([L144-L161](../apps/server/src/engine/worker.ts#L144-L161)).
- **Settle:** on success, the result is checkpointed and the lease cleared ([L204](../apps/server/src/engine/worker.ts#L204)). A lost lease requeues the task ([L213-L220](../apps/server/src/engine/worker.ts#L213-L220)); an error marks it `failed` ([L221-L238](../apps/server/src/engine/worker.ts#L221-L238)). Each attempt is stored as a `runs` record keyed by its lease ID ([L192-L211](../apps/server/src/engine/worker.ts#L192-L211)).
- **External writes** (email, calendar) are reviewed `actions`. They are claimed with a separate atomic `UPDATE` that also checks the parent task is still active ([db.ts L116-L128](../apps/server/src/db.ts#L116-L128)). Actions left `executing` at startup become `outcome_unknown` and are never retried ([db.ts L129-L133](../apps/server/src/db.ts#L129-L133), [index.ts L11](../apps/server/src/index.ts#L11)).
- **Maintenance:** every 60 s the API republishes outcomes, re-activates monitors, recovers accepted ideas and refreshes ideas, for every owner ([service.ts L71-L128](../apps/server/src/engine/service.ts#L71-L128)).
- The Linux computer has its own per-owner lease row, `computer-state/lease` ([apps/server/src/computer.ts L224-L250](../apps/server/src/computer.ts#L224-L250)).

## 4. Data model

There is **one table**, created on startup. There are no migrations and no indexes beyond the primary key ([db.ts L176-L178](../apps/server/src/db.ts#L176-L178)):

```sql
records(owner text, kind text, id text, data jsonb, updated_at timestamptz, PRIMARY KEY(owner, kind, id))
```

- **Backend choice:** if `DATABASE_URL` is set, `pg.Pool` (max 5) is used. Otherwise embedded PGlite runs at `${DATA_DIR}/postgres` ([db.ts L153-L175](../apps/server/src/db.ts#L153-L175), [index.ts L7-L10](../apps/server/src/index.ts#L7-L10)). Noa sets `DATABASE_URL`.
- **Access API:** `get/list/put/remove/insertIfAbsent/take` are all keyed by `owner`. `scan(kind)` reads across owners, for background work only ([db.ts L13-L151](../apps/server/src/db.ts#L13-L151)). Status and goal lookups filter on JSONB fields without an index ([db.ts L33-L54](../apps/server/src/db.ts#L33-L54)).
- **Kinds used** (the `kind` column): `tasks`, `runs`, `run-events`, `actions`, `ideas`, `goals`, `monitors`, `monitor-pages`, `notifications`, `activity`, `memories`, `agent-settings`, `agent-artifacts`, `settings`, `credentials`, `conversation-settings`, `conversations`, `drafts`, `files`, `imports`, `browsers`, `chat-browsers`, `browser-downloads`, `search-sessions`, `computer-state`, `computer-commands` and `computer-desktop-*` ([apps/server/src/computer-backend.ts L74](../apps/server/src/computer-backend.ts#L74), [L328](../apps/server/src/computer-backend.ts#L328)), `jev_threads` ([apps/server/src/jev/service.ts L61](../apps/server/src/jev/service.ts#L61)), plus sample data (`mail`, `events`, `sample-pages`).
- **Global rows** use owner `"system"`: `sessions` ([apps/server/src/auth.ts L24-L28](../apps/server/src/auth.ts#L24-L28)), `oauth` state ([apps/server/src/google-auth.ts L124](../apps/server/src/google-auth.ts#L124), [L148](../apps/server/src/google-auth.ts#L148)) and `worker-status` ([worker.ts L69](../apps/server/src/engine/worker.ts#L69)).
- **Typed shapes** live in [packages/domain/src/index.ts](../packages/domain/src/index.ts) and [packages/domain/src/agent.ts](../packages/domain/src/agent.ts) (`AgentTask`, `RunEvent`, …).
- **On disk, outside SQL:** PDFs at `${DATA_DIR}/files/<id>.pdf`, in one flat directory for all owners ([apps/server/src/files.ts L64-L68](../apps/server/src/files.ts#L64-L68), [L116-L122](../apps/server/src/files.ts#L116-L122)); the HMAC signing key at `${DATA_DIR}/session-signing-key` ([auth.ts L68-L90](../apps/server/src/auth.ts#L68-L90)); browser profiles in the worker's `/data` volume ([infra/compose.yaml](../infra/compose.yaml)); and the computer's `/workspace` named volume per owner ([computer.ts L138-L150](../apps/server/src/computer.ts#L138-L150)).
- **Chat messages are not in Postgres.** They live in CopilotKit Intelligence (section 7). Only the main thread ID is stored (`conversation-settings/main`) ([app.ts L208-L230](../apps/server/src/app.ts#L208-L230)). A legacy `/api/conversation` endpoint still stores a message array in `conversations/default` ([app.ts L231-L240](../apps/server/src/app.ts#L231-L240)).

## 5. Where auth is enforced

- **Sign-in:** `POST /api/session` checks `OPENMUSE_ACCESS_KEY` in live mode using a timing-safe comparison. It issues a random bearer token that is stored hashed in `system/sessions` with a 24 h expiry ([auth.ts L15-L30](../apps/server/src/auth.ts#L15-L30), [app.ts L108-L121](../apps/server/src/app.ts#L108-L121)). Live mode refuses to start without a 24+ character access key and `TOKEN_ENCRYPTION_KEY` ([config.ts L173-L179](../apps/server/src/config.ts#L173-L179)).
- **Request gate:** one middleware on `/api/*` resolves `owner` from `Authorization: Bearer` (`auth.owner`) and stores it in the Hono context. Signed file and browser-preview URLs are verified instead ([app.ts L133-L144](../apps/server/src/app.ts#L133-L144), [auth.ts L31-L67](../apps/server/src/auth.ts#L31-L67)). Routes registered before it are public: `/api/health`, `/api/session` and `/api/google/callback`, which is protected by single-use OAuth state ([app.ts L98-L132](../apps/server/src/app.ts#L98-L132)).
- **Chat:** `/api/copilotkit/*` sits behind the same middleware. The agent factory and `identifyUser` resolve the owner again from the header ([agent.ts L43](../apps/server/src/agent.ts#L43), [L63-L66](../apps/server/src/agent.ts#L63-L66)). Intelligence threads are scoped by that user ID ([app.ts L218-L222](../apps/server/src/app.ts#L218-L222)).
- **Data isolation:** every route passes `c.get("owner")` into services, and every `Store` query filters by `owner` ([db.ts L15-L68](../apps/server/src/db.ts#L15-L68)).
- **Other layers:** an origin allowlist (`ALLOWED_ORIGINS` plus `PUBLIC_API_URL`) ([app.ts L53-L70](../apps/server/src/app.ts#L53-L70)); an IP rate limit that only trusts forwarded headers when `TRUST_PROXY=true` ([apps/server/src/rate-limit.ts L46-L60](../apps/server/src/rate-limit.ts#L46-L60), [config.ts L169-L171](../apps/server/src/config.ts#L169-L171)); and a sign-in throttle of 30 attempts per minute ([app.ts L106-L115](../apps/server/src/app.ts#L106-L115)).
- **Browser worker:** one shared `WORKER_TOKEN` (32+ characters), checked with a hash comparison ([apps/worker/src/server.ts L42-L62](../apps/worker/src/server.ts#L42-L62)). The worker has no notion of an owner. The API enforces ownership by recording the session under the owner before calling the worker ([apps/server/src/browser.ts L128-L138](../apps/server/src/browser.ts#L128-L138)).
- **Linux computer:** a nonroot, read-only container with all capabilities dropped and `--network none` ([computer-backend.ts L220-L240](../apps/server/src/computer-backend.ts#L220-L240)).
- **Secrets at rest:** Google tokens are AES-encrypted with `TOKEN_ENCRYPTION_KEY` ([packages/integrations/src/vault.ts](../packages/integrations/src/vault.ts), [google-auth.ts L52-L67](../apps/server/src/google-auth.ts#L52-L67)).
- **Client:** the token is held only in React state and is not persisted across launches ([apps/mobile/App.tsx L70-L79](../apps/mobile/App.tsx#L70-L79)). It is sent to the runtime as a header ([L93-L96](../apps/mobile/App.tsx#L93-L96)).

## 6. How connectors plug into `packages/integrations`

`packages/integrations` holds provider clients only. It has no HTTP routes and no storage:

- [google.ts](../packages/integrations/src/google.ts#L462-L466): `GoogleClient`, constructed with a `getAccessToken` callback (Gmail/Calendar read plus send/create/update/delete).
- [vault.ts](../packages/integrations/src/vault.ts#L12-L25): `encryptSecret` / `decryptSecret`.
- [pdf.ts](../packages/integrations/src/pdf.ts#L93-L155): PDF inspection and filling.

Wiring a connector into the server takes these steps (Google is the only live example):

1. **OAuth and credential storage:** `GoogleAuth` runs the consent flow, stores encrypted tokens as `credentials/google` per owner, and refreshes them ([apps/server/src/google-auth.ts](../apps/server/src/google-auth.ts#L44-L160)).
2. **Client factory:** `WorkspaceService.google(owner)` builds a `GoogleClient` bound to that owner's token ([apps/server/src/workspace.ts L31-L35](../apps/server/src/workspace.ts#L31-L35)).
3. **Reads become tools:** chat tools (`search_mail`, `read_mail`, calendar) in [conversation.ts L149-L260](../apps/server/src/engine/conversation.ts#L149-L260) and task tools in [model.ts L88-L170](../apps/server/src/engine/model.ts#L88-L170).
4. **Writes go through reviewed actions:** a discriminated `proposalSchema` ([packages/domain/src/index.ts L128-L139](../packages/domain/src/index.ts#L128-L139)) feeds `ActionService` with `prepare`/`execute` callbacks ([apps/server/src/actions.ts L11-L25](../apps/server/src/actions.ts#L11-L25), [app.ts L40-L46](../apps/server/src/app.ts#L40-L46)). A read-only connector such as Plaid skips this step.
5. **Status in the UI:** the hard-coded `connections` list in the workspace snapshot ([workspace.ts L336-L362](../apps/server/src/workspace.ts#L336-L362)).
6. **Prompt:** the chat prompt currently says connectors other than Google are unavailable ([conversation.ts L389](../apps/server/src/engine/conversation.ts#L389)).

[packages/backends/src/openbot.ts](../packages/backends/src/openbot.ts) is a separate, disabled adapter for an external agent backend, not a data connector.

## 7. Telemetry and threads

**Telemetry.** No PostHog SDK is in the app. The CopilotKit runtime sends its own events to `telemetry.copilotkit.ai` ([docs/TELEMETRY.md](TELEMETRY.md)). OpenMuse:

- defaults `COPILOTKIT_TELEMETRY_SAMPLE_RATE=1` before the runtime is imported ([config.ts L26-L28](../apps/server/src/config.ts#L26-L28));
- tags events with `accessibility_title: "OpenMuse"` ([agent.ts L61-L62](../apps/server/src/agent.ts#L61-L62)).

`CPK_TELEMETRY_ID` is not read by app code; the SDK picks it up from the environment ([render.yaml L48-L50](../render.yaml#L48-L50), [tests/telemetry.test.ts L53](../tests/telemetry.test.ts#L53)). Opt-outs are `COPILOTKIT_TELEMETRY_DISABLED` and `DO_NOT_TRACK` ([.env.example](../.env.example)). Tests disable telemetry ([tests/setup.ts L4](../tests/setup.ts#L4)). Noa keeps the defaults.

**Threads: is there a self-hosted mode? Not in OpenMuse.**

- `CPK_INTELLIGENCE_API_KEY` is required at config load in every mode ([config.ts L152](../apps/server/src/config.ts#L152), [L80-L88](../apps/server/src/config.ts#L80-L88)).
- The runtime is always constructed with `CopilotKitIntelligence` ([app.ts L50-L51](../apps/server/src/app.ts#L50-L51)).
- `/api/main-thread` calls `intelligence.getOrCreateThread` ([app.ts L217-L222](../apps/server/src/app.ts#L217-L222)).
- The client thread menu uses `useThreads` ([apps/mobile/src/threads.tsx L115](../apps/mobile/src/threads.tsx#L115)).

The underlying `@copilotkit/runtime@1.70.1` does have an "SSE mode" when `intelligence` is omitted. It defaults to `InMemoryAgentRunner`, which serves list/get thread endpoints locally but loses them on restart. Rename and archive return HTTP 422 without Intelligence. That comes from the published package's `dist/v2/runtime/core/runtime.mjs` and `dist/v2/runtime/handlers/intelligence/threads.mjs`, which are not vendored here. A durable self-hosted mode would need a custom `AgentRunner` backed by Postgres, plus removing the hard requirement in `config.ts`. Noa uses Intelligence (Developer plan), as decided.

## 8. Every place that assumes a single user

| # | Assumption | Where |
| --- | --- | --- |
| 1 | Every session is created for the hard-coded owner `"local-user"`. | [auth.ts L23-L28](../apps/server/src/auth.ts#L23-L28) |
| 2 | Sign-in seeds sample data, the agent identity and ideas for `"local-user"`, not for the signed-in person. | [app.ts L117-L119](../apps/server/src/app.ts#L117-L119) |
| 3 | A single shared secret (`OPENMUSE_ACCESS_KEY`) is the only credential. There are no accounts or user table. | [config.ts L143](../apps/server/src/config.ts#L143), [auth.ts L15-L22](../apps/server/src/auth.ts#L15-L22), [README.md L150](../README.md#L150), [docs/RICH-THREADS.md](RICH-THREADS.md) |
| 4 | The sign-in throttle is one process-wide counter (30/min), not per IP or account. Five users can lock each other out. | [app.ts L106-L115](../apps/server/src/app.ts#L106-L115) |
| 5 | `identifyUser` gives every user the same display name, "OpenMuse user". | [agent.ts L63-L66](../apps/server/src/agent.ts#L63-L66) |
| 6 | Agent persona defaults to "OpenMuse" (identity row and prompts). | [service.ts L129-L134](../apps/server/src/engine/service.ts#L129-L134), [conversation.ts L389](../apps/server/src/engine/conversation.ts#L389), [model.ts L331](../apps/server/src/engine/model.ts#L331) |
| 7 | The task worker scans **all** owners' tasks every second and caps concurrency at 3 per process, globally, with no per-owner fairness. | [worker.ts L78-L89](../apps/server/src/engine/worker.ts#L78-L89) |
| 8 | Maintenance and idea refresh loop over every owner serially, every 60 s. | [service.ts L85-L128](../apps/server/src/engine/service.ts#L85-L128) |
| 9 | One browser worker and token for everyone: 3 open sessions and 20 saved profiles in total, with no owner awareness in the worker. | [apps/worker/src/browser.ts L44](../apps/worker/src/browser.ts#L44), [L165-L173](../apps/worker/src/browser.ts#L165-L173), [apps/worker/src/server.ts L42-L62](../apps/worker/src/server.ts#L42-L62) |
| 10 | PDFs share one flat directory. Isolation relies only on the `files` row's owner. | [files.ts L64-L68](../apps/server/src/files.ts#L64-L68) |
| 11 | One Google OAuth client and redirect for the deployment. Tokens are per owner, but test users must be added in Google Cloud. | [config.ts L153-L155](../apps/server/src/config.ts#L153-L155), [google-auth.ts L132-L135](../apps/server/src/google-auth.ts#L132-L135) |
| 12 | The workspace snapshot hard-codes the connection list and `openbotConfigured: false`. | [workspace.ts L336-L368](../apps/server/src/workspace.ts#L336-L368) |
| 13 | Linux computers are already per owner (a container and volume named by owner hash), but all run on one Docker host with no per-user quota. | [computer.ts L138-L150](../apps/server/src/computer.ts#L138-L150) |
| 14 | The client never persists a session and has a single access-key prompt. There is no notion of a user profile on device. | [apps/mobile/App.tsx L69-L98](../apps/mobile/App.tsx#L69-L98) |
| 15 | The legacy conversation store uses one fixed ID, `conversations/default`, per owner. | [app.ts L231-L240](../apps/server/src/app.ts#L231-L240) |
| 16 | Demo and smoke tests seed `"local-user"`. | [apps/server/src/demo/entry.ts L38-L40](../apps/server/src/demo/entry.ts#L38-L40), [apps/computer/smoke.test.ts L36](../apps/computer/smoke.test.ts#L36) |

The owner column, owner-scoped queries, owner-bound signed URLs, per-owner computers and Intelligence `userId` mean the data layer is already multi-tenant. The single-user parts are concentrated in identity: items 1–5 and 14. Sign in with Apple would replace `Auth.session` with a verified Apple `sub` mapped to an owner ID.

## 9. Notes for Ticket 1 (deploy)

- [infra/compose.yaml](../infra/compose.yaml) has only `browser-worker`. API, web, Postgres, Caddy and the computer image have to be added.
- The web client bakes `EXPO_PUBLIC_API_URL` in at build time ([apps/mobile/src/api.ts L4-L7](../apps/mobile/src/api.ts#L4-L7), [render.yaml](../render.yaml)).
- The API needs `HOST=0.0.0.0` in live mode, `TRUST_PROXY=true` behind Caddy, and Docker socket access for `COMPUTER_ENABLED=true` ([config.ts L139-L171](../apps/server/src/config.ts#L139-L171), [docs/COMPUTER.md](COMPUTER.md)).
- The app display name is `expo.name` / `web.name` in [apps/mobile/app.json](../apps/mobile/app.json) plus the strings in item 6.
