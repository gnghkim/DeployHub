# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

# 의존성 스토어만 lockfile 로 채운다. package.json 목록을 하드코딩하지 않으므로
# 워크스페이스에 패키지가 늘어도 이 스테이지를 고칠 필요가 없다.
# (M1b 에서 packages/collectors 를 추가했을 때 하드코딩 목록 때문에
#  컨테이너 안에서 @octokit/rest 가 설치되지 않아 빌드가 깨졌다.)
# 루트 package.json 은 반드시 함께 복사한다. corepack 이 packageManager 핀을
# 읽어야 lockfile 을 만든 것과 같은 pnpm 버전을 쓴다. 이것이 없으면 최신 pnpm 이
# 실행되고, 그 버전의 minimumReleaseAge 기본값이 최근 배포 패키지를 거부한다.
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
RUN pnpm fetch

FROM deps AS build
COPY . .
RUN pnpm install --frozen-lockfile --offline
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
