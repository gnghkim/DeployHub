# syntax=docker/dockerfile:1@sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89

FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94 AS build

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /build

RUN corepack enable
COPY package.json ./package.json
COPY apps/snapshotter/package.json apps/snapshotter/pnpm-lock.yaml ./apps/snapshotter/
WORKDIR /build/apps/snapshotter
RUN pnpm fetch --ignore-scripts

COPY tsconfig.base.json /build/tsconfig.base.json
COPY apps/snapshotter/tsconfig.json apps/snapshotter/tsup.config.ts ./
COPY apps/snapshotter/src ./src
RUN --network=none pnpm install --frozen-lockfile --offline \
 && pnpm build \
 && pnpm prune --prod --ignore-scripts

FROM mcr.microsoft.com/playwright:v1.62.0-noble@sha256:baed2032d533817f3dbe6425de795788430ba345e819a1201337009ba17c9d07 AS runtime

ENV NODE_ENV=production \
    PORT=3001 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app

COPY --from=build --chown=pwuser:pwuser /build/apps/snapshotter/node_modules ./node_modules
COPY --from=build --chown=pwuser:pwuser /build/apps/snapshotter/dist ./dist
RUN chown pwuser:pwuser /app

USER pwuser
CMD ["node", "dist/server.js"]
