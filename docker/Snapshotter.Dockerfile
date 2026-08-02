# syntax=docker/dockerfile:1

FROM node:22.22.0-bookworm-slim AS build

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /build

RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/snapshotter/package.json apps/snapshotter/package.json
RUN pnpm fetch

COPY tsconfig.base.json ./
COPY apps/snapshotter/tsconfig.json apps/snapshotter/tsup.config.ts apps/snapshotter/
COPY apps/snapshotter/src apps/snapshotter/src
RUN pnpm install --frozen-lockfile --offline \
 && pnpm --filter snapshotter build \
 && pnpm --filter snapshotter deploy --prod /snapshotter

FROM mcr.microsoft.com/playwright:v1.62.0-noble AS runtime

ENV NODE_ENV=production \
    PORT=3001 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app

COPY --from=build --chown=pwuser:pwuser /snapshotter/node_modules ./node_modules
COPY --from=build --chown=pwuser:pwuser /build/apps/snapshotter/dist ./dist
RUN chown pwuser:pwuser /app

USER pwuser
CMD ["node", "dist/server.js"]
