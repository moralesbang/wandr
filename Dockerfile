# One image runs Wandr: Hono serves the API and the SPA's built files.
FROM oven/bun:1.4.5-slim AS base
WORKDIR /app
COPY package.json bun.lock bunfig.toml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/contract/package.json packages/contract/
COPY packages/sharing/package.json packages/sharing/
COPY packages/tsconfig/package.json packages/tsconfig/
COPY packages/oxlint-plugin-wandr/package.json packages/oxlint-plugin-wandr/

# The SPA's build. CI has already typechecked and tested it.
FROM base AS web
RUN bun install --frozen-lockfile --filter @wandr/web
COPY packages packages
COPY apps/web apps/web
RUN cd apps/web && bunx --bun vite build

# Only what the API needs at runtime.
FROM base AS api-deps
RUN bun install --frozen-lockfile --production --filter @wandr/api

FROM oven/bun:1.4.5-slim
WORKDIR /app
ENV NODE_ENV=production \
    WEB_DIST=/app/apps/web/dist
COPY --from=api-deps /app ./
COPY packages/contract packages/contract
COPY packages/sharing packages/sharing
COPY apps/api apps/api
COPY --from=web /app/apps/web/dist apps/web/dist
USER bun
WORKDIR /app/apps/api
EXPOSE 3000
# Railway's pre-deploy command runs `bun src/db/migrate.ts` in this image first.
CMD ["bun", "src/index.ts"]
