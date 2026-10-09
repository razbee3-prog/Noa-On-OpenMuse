#!/usr/bin/env bash
# Builds and (re)starts the Noa stack on the droplet, then waits for HTTPS health.
# Usage (on the droplet): /opt/noa/app/infra/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE="${ENV_FILE:-/opt/noa/.env}"
SITE_ADDRESS="$(sed -n 's/^SITE_ADDRESS=//p' "$ENV_FILE")"
compose=(docker compose --env-file "$ENV_FILE" -f infra/compose.yaml)

"${compose[@]}" build --pull
"${compose[@]}" up -d --remove-orphans
docker image prune -f >/dev/null

for _ in $(seq 1 60); do
  if curl -fsS --max-time 5 "https://${SITE_ADDRESS}/api/health" >/dev/null; then
    echo "healthy: https://${SITE_ADDRESS}/api/health"
    exit 0
  fi
  sleep 5
done
"${compose[@]}" ps
"${compose[@]}" logs --tail 50 api caddy
exit 1
