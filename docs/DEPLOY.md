# Deploying Noa on OpenMuse

One Ubuntu droplet runs the whole stack with Docker Compose ([infra/compose.yaml](../infra/compose.yaml)).

| Service | Image | Reachable from |
| --- | --- | --- |
| `caddy` | [infra/web.Dockerfile](../infra/web.Dockerfile): Expo web export + Caddy | Public, 80/443 (HTTPS via Let's Encrypt on `SITE_ADDRESS`) |
| `api` | [infra/api.Dockerfile](../infra/api.Dockerfile) | Caddy only (`/api/*`) |
| `postgres` | `postgres:17-alpine` | API only (`db` network, internal) |
| `browser-worker` | [apps/worker/Dockerfile](../apps/worker/Dockerfile) | API only (`browser` network) |
| `docker-proxy` | `linuxserver/socket-proxy` | API only (`docker-api` network, internal) |
| `computer-image` | [apps/computer/Dockerfile](../apps/computer/Dockerfile) | Build-only; exits after tagging `openmuse-computer:local` |

Per-user computer containers are created by the API through the socket proxy, with `--network none`.

## Layout on the droplet

- `/opt/noa/app/`: source tree, synced by the deploy workflow (`rsync --delete`).
- `/opt/noa/.env` (mode 600): all runtime secrets. It is never in git.
- Docker volumes `noa_postgres-data`, `noa_api-data`, `noa_browser-profiles`, `noa_caddy-data`, plus one computer volume per owner.

## `/opt/noa/.env` keys

`SITE_ADDRESS`, `MODEL`, `ANTHROPIC_API_KEY`, `CPK_INTELLIGENCE_API_KEY`, `CPK_TELEMETRY_ID`, `OPENMUSE_ACCESS_KEY`, `TOKEN_ENCRYPTION_KEY`, `POSTGRES_PASSWORD`, `WORKER_TOKEN`, `COMPUTER_DEPLOYMENT_ID`, `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV` (`sandbox` or `production`), and optionally `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`.

The same values are stored as GitHub repository secrets, as a backup.

## Accounts

- iPhone users sign in only with Apple. The server checks Apple's signed identity token against Apple's public keys and the audience in `APPLE_AUDIENCES` (default `com.razbhimani.noa`; optional key in `/opt/noa/.env`). The owner ID is a hash of the Apple user ID.
- Anyone who signs in with Apple gets an account on first sign-in; there are no invite codes.
- Sessions last 30 days. The iPhone keeps its session in the Keychain; the web app keeps it until the tab closes.
- Limits per account: 10 sign-in attempts a minute per IP, 2 running agent tasks, 2 active browser sessions and 4 saved browser profiles. PDFs live under `/data/files/<owner-hash>/`.

## Plaid (read-only)

- Each account links its own bank under Apps > Bank (Plaid), using Plaid Hosted Link. The access token is encrypted with `TOKEN_ENCRYPTION_KEY` and stored per owner.
- Only Balances and Transactions are used. The client in `packages/integrations/src/plaid.ts` has no transfer or payment endpoints.
- The droplet runs `PLAID_ENV=sandbox`. To go live, set `PLAID_SECRET` to the production secret and `PLAID_ENV=production` in `/opt/noa/.env`, then run `infra/deploy.sh`.

## Langfuse tracing

With both Langfuse keys in `/opt/noa/.env`, the API sends one trace per model run to Langfuse (`apps/server/src/langfuse.ts`): `chat-reply` for chat turns (session = chat thread), `run-task` for delegated tasks (session = task ID, tagged with the task kind), and `review-lessons`, `consolidate-memory`, `review-playbooks` for background reviews. Each trace has a generation per model call and a tool observation per tool call, with the owner ID as the user. Without the keys nothing is sent.

## Deploys

[.github/workflows/deploy.yml](../.github/workflows/deploy.yml) runs on every push to `main` (and manually). It rsyncs the checkout to `/opt/noa/app/` and runs [infra/deploy.sh](../infra/deploy.sh), which rebuilds, restarts, and waits for `https://$SITE_ADDRESS/api/health`.

GitHub secrets the workflow needs: `DEPLOY_SSH_KEY`, `DROPLET_HOST`, `DROPLET_KNOWN_HOSTS`.

Manual deploy on the droplet: `/opt/noa/app/infra/deploy.sh`.

## Hardening

- SSH: key only (`/etc/ssh/sshd_config.d/00-noa-hardening.conf`).
- `ufw`: deny incoming except 22/tcp, 80/tcp, 443/tcp, 443/udp. Docker-published ports bypass ufw, so only Caddy may use `ports:`.
