# syntax=docker/dockerfile:1
FROM node:22.22.0-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@11.19.0
COPY . .
RUN pnpm install --frozen-lockfile --filter openmuse && pnpm build:server

FROM node:22.22.0-bookworm-slim
# Only the Docker CLI: the API reaches the daemon through the filtered socket proxy.
COPY --from=docker:29-cli /usr/local/bin/docker /usr/local/bin/docker
WORKDIR /app
RUN npm install -g pnpm@11.19.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/worker/package.json apps/worker/package.json
RUN pnpm install --frozen-lockfile --prod --filter openmuse && pnpm store prune
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787 DATA_DIR=/data
USER node
EXPOSE 8787
CMD ["node", "dist/apps/server/src/index.js"]
