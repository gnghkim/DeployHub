# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm typecheck \
 && pnpm --filter web build \
 && pnpm --filter worker build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/drizzle ./drizzle
USER node
CMD ["node", "apps/web/server.js"]
