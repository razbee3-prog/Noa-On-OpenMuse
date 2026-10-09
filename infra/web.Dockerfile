# syntax=docker/dockerfile:1
FROM node:22.22.0-bookworm-slim AS build
WORKDIR /app
RUN npm install -g pnpm@11.19.0
COPY . .
ARG EXPO_PUBLIC_API_URL
ENV EXPO_PUBLIC_API_URL=${EXPO_PUBLIC_API_URL}
RUN test -n "$EXPO_PUBLIC_API_URL" \
  && pnpm install --frozen-lockfile \
  && pnpm --dir apps/mobile exec expo export --platform web --output-dir dist/web --clear

FROM caddy:2.10-alpine
COPY infra/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/mobile/dist/web /srv
