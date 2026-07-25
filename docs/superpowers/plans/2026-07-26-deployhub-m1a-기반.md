# DeployHub M1a (기반) Implementation Plan

> **For agentic workers:** 이 계획은 orca orchestration으로 codex 워커에게 카드 단위 위임된다. 각 Task는 격리된 worktree에서 수행하고, 검증 명령이 모두 통과한 뒤 Claude의 설계 부합 검토를 거쳐 main에 병합한다. Steps는 체크박스(`- [ ]`)로 추적한다.

**Goal:** DeployHub의 실행 기반을 세운다 — pnpm 모노레포, Docker Compose 인프라, Drizzle 스키마 v1, 동시성이 검증된 job 큐, GitHub OAuth 인증.

**Architecture:** pnpm workspace 위에 `apps/web`(Next.js)와 `apps/worker`(장기 실행 프로세스)를 두고 **하나의 멀티스테이지 Dockerfile로 같은 이미지를 빌드**한 뒤 `command`로 갈라 띄운다. 상태는 전부 PostgreSQL 17에 두고 Drizzle로 접근한다. 비동기 작업은 Redis 없이 `jobs` 테이블 + `FOR UPDATE SKIP LOCKED` 폴링으로 처리한다.

**Tech Stack:** pnpm workspace · TypeScript(strict) · Next.js App Router · Auth.js · Drizzle ORM · PostgreSQL 17 · Vitest · Testcontainers · Docker Compose · Caddy

**근거 문서:** `docs/superpowers/specs/2026-07-26-deployhub-구축방안.md` (이하 "구축방안")

---

## Global Constraints

모든 Task의 요구사항에 아래가 암묵적으로 포함된다.

- **Node.js 22 LTS**, **pnpm 9** 이상. `package.json`에 `"engines"`와 `"packageManager"`를 명시한다.
- **TypeScript strict 모드 필수.** `strict: true`, `noUncheckedIndexedAccess: true`. `any` 사용 금지 — 불가피하면 `unknown` + 좁히기.
- **PostgreSQL 17.** 호스트 포트를 매핑하지 않는다(구축방안 3.1).
- **버전 고정:** 의존성은 설치 시점의 최신 안정판을 쓰되, 설치 후 실제 resolve된 버전을 `README.md`의 "확정 버전" 표에 기록한다. `latest` 태그를 `package.json`에 남기지 않는다.
- **의존성 설치는 각 Task 안에서 한다.** 뒤 Task에서 쓸 패키지를 미리 설치하지 않는다. 각 Task의 Step에 그 Task가 필요로 하는 설치 명령이 명시돼 있다.
- **내부 패키지는 소스를 직접 노출한다.** `packages/*`의 `package.json`은 `main`/`types`를 `dist`가 아니라 `./src/index.ts`로 지정한다. `dist`를 가리키면 테스트 실행 전에 빌드가 필요해져 테스트가 빌드 순서에 묶인다.
- **비밀값 금지:** 실제 토큰·비밀번호·키를 저장소에 커밋하지 않는다. `.env.example`에는 **변수 이름만** 넣는다(구축방안 R4·R9).
- **줄바꿈:** `.gitattributes`가 `*.sh`, `Dockerfile`, `Caddyfile`, `*.yml`을 LF로 고정한다. 이를 해제하지 않는다.
- **커밋 메시지:** Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`). 한국어 본문 허용.
- **테스트 러너:** Vitest. DB가 필요한 테스트는 Testcontainers로 실제 PostgreSQL 17을 띄운다. **DB를 모킹하지 않는다** — 이 계획의 핵심 검증 대상이 SQL 동시성 semantics이므로 모킹하면 검증 가치가 사라진다.

---

## File Structure

M1a가 만드는 파일과 각 파일의 책임이다.

```
deployhub/
├─ package.json                    workspace 루트. 스크립트만 보유, 앱 의존성 없음
├─ pnpm-workspace.yaml             apps/* packages/* 등록
├─ tsconfig.base.json              공통 컴파일러 설정. 각 패키지가 extends
├─ vitest.workspace.ts             패키지별 테스트 프로젝트 등록
├─ .env.example                    변수 이름만
│
├─ packages/
│  ├─ shared/
│  │  ├─ package.json
│  │  └─ src/
│  │     ├─ index.ts               재export
│  │     └─ env.ts                 환경변수 스키마 파싱·검증 (fail fast)
│  │
│  └─ db/
│     ├─ package.json
│     ├─ drizzle.config.ts         마이그레이션 설정
│     └─ src/
│        ├─ index.ts               db 클라이언트 생성·재export
│        ├─ client.ts              Pool 생성, 연결 수명 관리
│        ├─ schema/
│        │  ├─ index.ts            전체 스키마 재export
│        │  ├─ enums.ts            pgEnum 정의 — 다른 스키마 파일이 참조
│        │  ├─ users.ts            users
│        │  ├─ projects.ts         projects, components
│        │  ├─ resources.ts        provider_accounts, resources, component_resources
│        │  └─ jobs.ts             jobs
│        └─ jobs/
│           ├─ index.ts            재export
│           ├─ queue.ts            enqueue / claim / complete / fail — SKIP LOCKED
│           └─ types.ts            JobRecord, ClaimOptions 등 공개 타입
│
├─ apps/
│  ├─ web/
│  │  ├─ package.json
│  │  ├─ next.config.ts            standalone 출력
│  │  └─ src/
│  │     ├─ auth/
│  │     │  ├─ allowlist.ts        화이트리스트 판정 — 순수 함수, 테스트 대상
│  │     │  └─ config.ts           Auth.js 설정. signIn 콜백에서 allowlist 적용
│  │     ├─ app/
│  │     │  ├─ layout.tsx          루트 레이아웃
│  │     │  ├─ page.tsx            로그인 상태 확인용 최소 화면
│  │     │  └─ api/auth/[...nextauth]/route.ts
│  │     └─ middleware.ts          미인증 요청 리다이렉트
│  │
│  └─ worker/
│     ├─ package.json
│     └─ src/
│        ├─ index.ts               진입점. 폴링 루프와 graceful shutdown
│        └─ runner.ts              claim → 핸들러 실행 → complete/fail
│
└─ docker/
   ├─ Dockerfile                   멀티스테이지. web·worker 산출물을 한 이미지에
   ├─ compose.yml                  web/worker/postgres/caddy
   └─ Caddyfile                    호스트명 미일치 차단 + 레이트리밋
```

**분할 원칙.** `schema/`를 도메인별 파일로 나눈 것은 한 파일에 테이블 7개를 넣으면 이후 M2~M4에서 14개로 늘 때 손댈 수 없는 크기가 되기 때문이다. `jobs/queue.ts`를 스키마와 분리한 것은 스키마는 선언이고 큐는 동작이라 테스트 대상이 다르기 때문이다.

---

## Task 1: 워크스페이스 뼈대와 PostgreSQL — ✅ 완료 (`7b78de0`, merge `422d589`)

**확정된 결과** (계획 작성 시점과 다른 부분):

- 루트 `devDependencies`: `typescript@7.0.2`, `vitest@4.1.10`, `@types/node@26.1.1` — 원래 계획 블록에 누락돼 있던 것을 보완
- `vitest.workspace.ts`는 설치된 Vitest 4에서 제거되어 **`vitest.config.ts`의 `test.projects: ['packages/*', 'apps/*']`** 로 대체
- 루트 typecheck 명령: `tsc --noEmit --project tsconfig.base.json` (TypeScript 7에서 `composite: true`와 `--noEmit` 공존 가능)
- `packages/shared/package.json`의 `main`/`types`는 `./src/index.ts`
- 확정 버전: Node 22.23.1 · pnpm 9.15.0 · TypeScript 7.0.2 · Vitest 4.1.10 · PostgreSQL 17.10

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.workspace.ts`, `.env.example`
- Create: `packages/shared/package.json`, `packages/shared/src/index.ts`, `packages/shared/src/env.ts`
- Create: `packages/shared/src/env.test.ts`
- Create: `docker/compose.yml`
- Modify: `README.md` (확정 버전 표 추가)

**Interfaces:**
- Consumes: 없음 (최초 Task)
- Produces:
  - `packages/shared` → `loadEnv(source: Record<string, string | undefined>): Env`
  - `type Env = { DATABASE_URL: string; NODE_ENV: 'development' | 'production' | 'test' }`
  - `loadEnv`는 필수 변수가 없으면 `throw new Error`로 즉시 실패한다 (fail fast)

- [ ] **Step 1: workspace 루트 생성**

`pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

루트 `package.json`:

```json
{
  "name": "deployhub",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "typecheck": "tsc --build --force",
    "test": "vitest run",
    "db:up": "docker compose -f docker/compose.yml up -d postgres",
    "db:down": "docker compose -f docker/compose.yml down"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "composite": true
  }
}
```

- [ ] **Step 2: 실패하는 테스트 작성**

`packages/shared/src/env.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

describe('loadEnv', () => {
  it('유효한 환경변수를 파싱한다', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://u:p@localhost:5432/deployhub',
      NODE_ENV: 'test',
    });
    expect(env.DATABASE_URL).toBe('postgres://u:p@localhost:5432/deployhub');
    expect(env.NODE_ENV).toBe('test');
  });

  it('DATABASE_URL이 없으면 변수명을 포함해 실패한다', () => {
    expect(() => loadEnv({ NODE_ENV: 'test' })).toThrow(/DATABASE_URL/);
  });

  it('NODE_ENV가 없으면 development로 기본값을 준다', () => {
    const env = loadEnv({ DATABASE_URL: 'postgres://u:p@localhost:5432/d' });
    expect(env.NODE_ENV).toBe('development');
  });

  it('NODE_ENV 값이 허용 목록 밖이면 실패한다', () => {
    expect(() =>
      loadEnv({ DATABASE_URL: 'postgres://u:p@localhost:5432/d', NODE_ENV: 'staging' }),
    ).toThrow(/NODE_ENV/);
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `pnpm vitest run packages/shared`
Expected: FAIL — `Cannot find module './env.js'`

- [ ] **Step 4: 최소 구현**

`packages/shared/src/env.ts`:

```ts
const NODE_ENVS = ['development', 'production', 'test'] as const;

export type NodeEnv = (typeof NODE_ENVS)[number];

export type Env = {
  DATABASE_URL: string;
  NODE_ENV: NodeEnv;
};

function requireString(
  source: Record<string, string | undefined>,
  key: string,
): string {
  const value = source[key];
  if (value === undefined || value.trim() === '') {
    throw new Error(`환경변수 ${key}가 설정되지 않았습니다.`);
  }
  return value;
}

export function loadEnv(source: Record<string, string | undefined>): Env {
  const rawNodeEnv = source.NODE_ENV ?? 'development';
  if (!(NODE_ENVS as readonly string[]).includes(rawNodeEnv)) {
    throw new Error(
      `환경변수 NODE_ENV 값이 올바르지 않습니다: ${rawNodeEnv} (허용: ${NODE_ENVS.join(', ')})`,
    );
  }
  return {
    DATABASE_URL: requireString(source, 'DATABASE_URL'),
    NODE_ENV: rawNodeEnv as NodeEnv,
  };
}
```

`packages/shared/src/index.ts`:

```ts
export { loadEnv } from './env.js';
export type { Env, NodeEnv } from './env.js';
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm vitest run packages/shared`
Expected: PASS — 4 tests

- [ ] **Step 6: PostgreSQL compose 작성**

`docker/compose.yml`:

```yaml
services:
  postgres:
    image: postgres:17-alpine
    container_name: deployhub-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: deployhub
      POSTGRES_USER: deployhub
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD required}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U deployhub -d deployhub"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks: [deployhub]
    labels:
      deployhub.project: "deployhub"
      deployhub.component: "postgres"
      deployhub.environment: "production"

volumes:
  postgres_data:

networks:
  deployhub:
```

호스트 포트를 매핑하지 않는다(구축방안 3.1). 로컬 테스트는 Testcontainers가 자체 인스턴스를 띄우므로 이 컨테이너에 접속할 필요가 없다.

`.env.example`:

```
# 값을 넣지 말 것. 변수 이름만 유지한다.
POSTGRES_PASSWORD=
DATABASE_URL=
NODE_ENV=
```

- [ ] **Step 7: 전체 검증**

Run: `pnpm install && pnpm typecheck && pnpm vitest run`
Expected: 설치 성공, 타입 오류 0, 테스트 4건 통과

Run: `POSTGRES_PASSWORD=devonly docker compose -f docker/compose.yml up -d postgres && sleep 5 && docker compose -f docker/compose.yml ps`
Expected: `deployhub-postgres`가 `healthy`

- [ ] **Step 8: README 확정 버전 기록**

`README.md`에 실제 resolve된 버전을 표로 남긴다 (Node, pnpm, TypeScript, Vitest, PostgreSQL).

- [ ] **Step 9: 커밋**

```bash
git add -A
git commit -m "feat: pnpm workspace 뼈대와 PostgreSQL compose 구성"
```

**게이트 통과 조건:** `pnpm install`·`pnpm typecheck`·`pnpm vitest run` 전부 성공, postgres 컨테이너 healthy, `.env.example`에 값이 없음.

---

## Task 2: Drizzle 스키마 v1

스키마는 **이 계획에 확정된 내용 그대로** 작성한다. 컬럼 추가·삭제·이름 변경을 임의로 하지 않는다. 변경이 필요해 보이면 구현을 멈추고 보고한다.

**Files:**
- Create: `packages/db/package.json`, `packages/db/drizzle.config.ts`
- Create: `packages/db/src/client.ts`, `packages/db/src/index.ts`
- Create: `packages/db/src/schema/{index,enums,users,projects,resources,jobs}.ts`
- Create: `packages/db/src/schema/schema.test.ts`
- Create: `packages/db/test/helpers/pg.ts` (Testcontainers 부트스트랩)
- Create: `drizzle/` (마이그레이션 생성 산출물)
- Create: `packages/shared/tsconfig.json`, `packages/db/tsconfig.json`
- Modify: `package.json` (typecheck 스크립트 교체)

**Step 0: 의존성 설치와 typecheck 구조 정비** (이 Task의 나머지 Step보다 먼저 수행한다)

- [ ] **0-1: 필요한 패키지를 설치한다**

```bash
pnpm --filter @deployhub/db add drizzle-orm pg
pnpm --filter @deployhub/db add -D drizzle-kit @types/pg @testcontainers/postgresql
```

- [ ] **0-2: 패키지별 tsconfig.json을 만든다**

Task 1이 남긴 `tsc --noEmit --project tsconfig.base.json` 방식은 **Task 5에서 깨진다.** `tsconfig.base.json`의 `lib`이 `["ES2023"]`이라 DOM이 없고 `jsx` 설정도 없어서, `apps/web`의 React/TSX 파일이 들어오는 순간 타입 오류가 쏟아진다. 지금 패키지별 tsconfig로 바꿔 그 사태를 예방한다.

`packages/shared/tsconfig.json`과 `packages/db/tsconfig.json` 모두 아래 형태로 만든다:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src", "test"]
}
```

각 패키지 `package.json`에 스크립트를 추가한다:

```json
"scripts": { "typecheck": "tsc --noEmit" }
```

- [ ] **0-3: 루트 typecheck를 재귀 실행으로 바꾼다**

루트 `package.json`의 `typecheck`를 아래로 교체한다.

```json
"typecheck": "pnpm -r typecheck"
```

이제 각 패키지가 자기 tsconfig로 검사하므로, Task 5에서 `apps/web`이 Next.js용 `jsx`·DOM 설정을 자기 tsconfig에 넣어도 다른 패키지에 영향을 주지 않는다.

- [ ] **0-4: 검증**

Run: `pnpm typecheck`
Expected: exit 0. 그리고 `pnpm --filter @deployhub/shared exec tsc --noEmit --listFilesOnly`로 `env.ts`가 실제 검사 대상에 포함되는지 확인한다. **exit 0이 "검사할 파일이 0개"를 뜻하지 않는지 반드시 확인한다.**

**Interfaces:**
- Consumes: `packages/shared` → `loadEnv`, `Env`
- Produces:
  - `createDb(connectionString: string): { db: NodePgDatabase<typeof schema>; close: () => Promise<void> }`
  - `schema` 네임스페이스 — `users`, `projects`, `components`, `providerAccounts`, `resources`, `componentResources`, `jobs`
  - enum 상수 — `projectStatus`, `projectLifecycle`, `componentType`, `resourceType`, `relationType`, `linkedBy`, `providerType`, `jobStatus`
  - 테스트 헬퍼 `withTestDb(fn: (db) => Promise<void>): Promise<void>` — 컨테이너 기동, 마이그레이션 적용, 종료까지 담당

- [ ] **Step 1: enum 정의**

`packages/db/src/schema/enums.ts`:

```ts
import { pgEnum } from 'drizzle-orm/pg-core';

export const projectStatus = pgEnum('project_status', [
  'active', 'paused', 'maintenance', 'archived',
]);

export const projectLifecycle = pgEnum('project_lifecycle', [
  'experimental', 'development', 'production', 'deprecated',
]);

export const componentType = pgEnum('component_type', [
  'frontend', 'backend', 'api', 'worker', 'scheduler', 'database',
  'authentication', 'storage', 'cache', 'queue', 'monitoring',
]);

export const resourceType = pgEnum('resource_type', [
  'vercel_project', 'vercel_deployment', 'supabase_project', 'hostinger_vps',
  'docker_container', 'docker_image', 'github_repository', 'domain',
  'database', 'storage_bucket', 'external_api',
]);

export const relationType = pgEnum('relation_type', [
  'runs_on', 'deployed_to', 'uses', 'depends_on', 'exposed_by', 'monitored_by',
]);

export const linkedBy = pgEnum('linked_by', [
  'manifest', 'label', 'repository', 'user', 'suggested',
]);

export const providerType = pgEnum('provider_type', [
  'github', 'vercel', 'supabase', 'hostinger', 'docker',
]);

export const jobStatus = pgEnum('job_status', [
  'pending', 'running', 'succeeded', 'failed',
]);
```

`cloudflare_zone`은 `resourceType`에 넣지 않는다 — 구축방안에서 Cloudflare를 전면 제외했다.

- [ ] **Step 2: users 스키마**

`packages/db/src/schema/users.ts`:

```ts
import { bigint, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  githubId: bigint('github_id', { mode: 'bigint' }).notNull().unique(),
  githubLogin: text('github_login').notNull().unique(),
  name: text('name'),
  email: text('email'),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
});
```

- [ ] **Step 3: projects·components 스키마**

`packages/db/src/schema/projects.ts`:

```ts
import { relations } from 'drizzle-orm';
import {
  index, jsonb, pgTable, smallint, text, timestamp, unique, uuid,
} from 'drizzle-orm/pg-core';
import { componentType, projectLifecycle, projectStatus } from './enums.js';

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  status: projectStatus('status').notNull().default('active'),
  lifecycle: projectLifecycle('lifecycle').notNull().default('development'),
  importance: smallint('importance').notNull().default(3),
  owner: text('owner'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp('archived_at', { withTimezone: true }),
});

export const components = pgTable(
  'components',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    componentType: componentType('component_type').notNull(),
    framework: text('framework'),
    runtime: text('runtime'),
    language: text('language'),
    criticality: smallint('criticality').notNull().default(3),
    fieldSources: jsonb('field_sources').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('components_project_slug_unique').on(t.projectId, t.slug),
    index('components_project_idx').on(t.projectId),
  ],
);

export const projectsRelations = relations(projects, ({ many }) => ({
  components: many(components),
}));

export const componentsRelations = relations(components, ({ one }) => ({
  project: one(projects, {
    fields: [components.projectId],
    references: [projects.id],
  }),
}));
```

`fieldSources`는 구축방안 7.1의 필드별 출처(`declared`/`detected`/`inferred`/`unknown`)를 담는다. M1a에서는 빈 객체로만 두고 M1b의 GitHub Collector가 채우기 시작한다.

- [ ] **Step 4: provider_accounts·resources·component_resources 스키마**

`packages/db/src/schema/resources.ts`:

```ts
import {
  boolean, index, jsonb, pgTable, text, timestamp, unique, uuid,
} from 'drizzle-orm/pg-core';
import { linkedBy, providerType, relationType, resourceType } from './enums.js';
import { components } from './projects.js';

export const providerAccounts = pgTable(
  'provider_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: providerType('provider').notNull(),
    name: text('name').notNull(),
    encryptedToken: text('encrypted_token').notNull(),
    scopes: jsonb('scopes').notNull().default([]),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('provider_accounts_provider_name_unique').on(t.provider, t.name)],
);

export const resources = pgTable(
  'resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: providerType('provider').notNull(),
    providerAccountId: uuid('provider_account_id').references(
      () => providerAccounts.id,
      { onDelete: 'set null' },
    ),
    externalId: text('external_id').notNull(),
    resourceType: resourceType('resource_type').notNull(),
    name: text('name').notNull(),
    status: text('status'),
    region: text('region'),
    url: text('url'),
    metadata: jsonb('metadata').notNull().default({}),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    unique('resources_provider_external_unique').on(t.provider, t.externalId),
    index('resources_type_idx').on(t.resourceType),
  ],
);

export const componentResources = pgTable(
  'component_resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    componentId: uuid('component_id')
      .notNull()
      .references(() => components.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    environment: text('environment').notNull().default('production'),
    relationType: relationType('relation_type').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    linkedBy: linkedBy('linked_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('component_resources_unique').on(t.componentId, t.resourceId, t.environment),
  ],
);
```

`providerAccountId`가 nullable인 것은 의도적이다 — 로컬 Docker 수집은 Provider 계정 없이 이뤄진다(구축방안 7.2).

- [ ] **Step 5: jobs 스키마**

`packages/db/src/schema/jobs.ts`:

```ts
import {
  index, integer, jsonb, pgTable, text, timestamp, uuid,
} from 'drizzle-orm/pg-core';
import { jobStatus } from './enums.js';

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    status: jobStatus('status').notNull().default('pending'),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('jobs_claim_idx').on(t.status, t.runAt)],
);
```

`jobs_claim_idx`가 `(status, run_at)` 순서인 이유는 Task 3의 claim 쿼리가 정확히 그 순서로 필터링·정렬하기 때문이다.

- [ ] **Step 6: 클라이언트와 재export**

`packages/db/src/schema/index.ts`:

```ts
export * from './enums.js';
export * from './users.js';
export * from './projects.js';
export * from './resources.js';
export * from './jobs.js';
```

`packages/db/src/client.ts`:

```ts
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index.js';

export type Db = NodePgDatabase<typeof schema>;

export function createDb(connectionString: string): {
  db: Db;
  close: () => Promise<void>;
} {
  const pool = new pg.Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { db, close: () => pool.end() };
}
```

`packages/db/src/index.ts`:

```ts
export { createDb } from './client.js';
export type { Db } from './client.js';
export * as schema from './schema/index.js';
```

- [ ] **Step 7: Testcontainers 헬퍼**

`packages/db/test/helpers/pg.ts`:

```ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb, type Db } from '../../src/index.js';

export type TestDb = { db: Db; connectionString: string };

let container: StartedPostgreSqlContainer | undefined;

export async function startTestDb(): Promise<TestDb & { stop: () => Promise<void> }> {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();
  const { db, close } = createDb(connectionString);
  await migrate(db, { migrationsFolder: 'drizzle' });
  return {
    db,
    connectionString,
    stop: async () => {
      await close();
      await container?.stop();
    },
  };
}
```

- [ ] **Step 8: 실패하는 스키마 테스트 작성**

`packages/db/src/schema/schema.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { startTestDb } from '../../test/helpers/pg.js';
import { schema, type Db } from '../index.js';

let db: Db;
let stop: () => Promise<void>;

beforeAll(async () => {
  const started = await startTestDb();
  db = started.db;
  stop = started.stop;
}, 120_000);

afterAll(async () => {
  await stop();
});

describe('스키마 v1', () => {
  it('프로젝트를 삭제하면 구성요소도 함께 삭제된다', async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({ name: 'LinkVault', slug: 'linkvault' })
      .returning();
    if (!project) throw new Error('project insert 실패');

    await db.insert(schema.components).values({
      projectId: project.id,
      name: 'web',
      slug: 'web',
      componentType: 'frontend',
    });

    await db.delete(schema.projects).where(eq(schema.projects.id, project.id));

    const remaining = await db
      .select()
      .from(schema.components)
      .where(eq(schema.components.projectId, project.id));
    expect(remaining).toHaveLength(0);
  });

  it('같은 프로젝트 안에서 구성요소 slug가 중복되면 거부한다', async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({ name: 'WorkWiki', slug: 'workwiki' })
      .returning();
    if (!project) throw new Error('project insert 실패');

    await db.insert(schema.components).values({
      projectId: project.id, name: 'web', slug: 'web', componentType: 'frontend',
    });

    await expect(
      db.insert(schema.components).values({
        projectId: project.id, name: 'web2', slug: 'web', componentType: 'api',
      }),
    ).rejects.toThrow();
  });

  it('provider와 external_id 조합이 중복되면 거부한다', async () => {
    await db.insert(schema.resources).values({
      provider: 'github', externalId: 'ktgo/workwiki',
      resourceType: 'github_repository', name: 'workwiki',
    });

    await expect(
      db.insert(schema.resources).values({
        provider: 'github', externalId: 'ktgo/workwiki',
        resourceType: 'github_repository', name: 'workwiki-dup',
      }),
    ).rejects.toThrow();
  });

  it('provider_account 없이 자원을 저장할 수 있다', async () => {
    const [resource] = await db
      .insert(schema.resources)
      .values({
        provider: 'docker', externalId: 'container-abc123',
        resourceType: 'docker_container', name: 'deployhub-web',
      })
      .returning();
    expect(resource?.providerAccountId).toBeNull();
  });

  it('enum 밖의 값은 거부한다', async () => {
    await expect(
      db.execute(
        `INSERT INTO projects (name, slug, status) VALUES ('X', 'x-invalid', 'zombie')`,
      ),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 9: 테스트가 실패하는지 확인**

Run: `pnpm vitest run packages/db`
Expected: FAIL — `drizzle` 마이그레이션 폴더가 없어 `migrate`가 실패

- [ ] **Step 10: 마이그레이션 생성**

`packages/db/drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema/index.ts',
  out: '../../drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
```

Run: `pnpm --filter @deployhub/db exec drizzle-kit generate`
Expected: `drizzle/0000_*.sql`과 `drizzle/meta/`가 생성된다

- [ ] **Step 11: 테스트 통과 확인**

Run: `pnpm vitest run packages/db`
Expected: PASS — 5 tests

- [ ] **Step 12: 커밋**

```bash
git add -A
git commit -m "feat: Drizzle 스키마 v1과 마이그레이션 추가"
```

**게이트 통과 조건:** 테이블 7개(users, projects, components, provider_accounts, resources, component_resources, jobs)가 마이그레이션으로 생성됨. 스키마 테스트 5건 통과. **계획에 없는 컬럼이 추가되지 않았을 것.**

---

## Task 3: job 큐 — SKIP LOCKED 동시성

이 Task의 핵심은 기능이 아니라 **동시성 정확도**다. 워커가 하나뿐이어도 재시작·중복 기동 상황에서 같은 job이 두 번 실행되면 외부 API를 이중 호출하게 된다. 테스트가 이 계획의 가장 중요한 산출물이다.

**Files:**
- Create: `packages/db/src/jobs/types.ts`, `packages/db/src/jobs/queue.ts`, `packages/db/src/jobs/index.ts`
- Create: `packages/db/src/jobs/queue.test.ts`
- Modify: `packages/db/src/index.ts` (jobs 재export 추가)

**Interfaces:**
- Consumes: Task 2 → `Db`, `schema.jobs`
- Produces:

```ts
export type JobRecord = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
};

export type EnqueueOptions = {
  type: string;
  payload?: Record<string, unknown>;
  runAt?: Date;
  maxAttempts?: number;
};

export function enqueue(db: Db, options: EnqueueOptions): Promise<JobRecord>;
export function claim(db: Db, workerId: string, limit: number, leaseSeconds: number): Promise<JobRecord[]>;
export function complete(db: Db, jobId: string): Promise<void>;
export function fail(db: Db, jobId: string, error: string): Promise<void>;
```

`fail`은 `attempts >= maxAttempts`이면 `status='failed'`로 확정하고, 아니면 `status='pending'`으로 되돌려 재시도 가능하게 한다.

- [ ] **Step 1: 공개 타입 정의**

`packages/db/src/jobs/types.ts`:

```ts
export type JobRecord = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  maxAttempts: number;
};

export type EnqueueOptions = {
  type: string;
  payload?: Record<string, unknown>;
  runAt?: Date;
  maxAttempts?: number;
};
```

- [ ] **Step 2: 실패하는 테스트 작성**

`packages/db/src/jobs/queue.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { startTestDb } from '../../test/helpers/pg.js';
import { schema, type Db } from '../index.js';
import { claim, complete, enqueue, fail } from './queue.js';

let db: Db;
let stop: () => Promise<void>;

beforeAll(async () => {
  const started = await startTestDb();
  db = started.db;
  stop = started.stop;
}, 120_000);

afterAll(async () => { await stop(); });
beforeEach(async () => { await db.delete(schema.jobs); });

describe('job 큐', () => {
  it('넣은 job을 claim한다', async () => {
    await enqueue(db, { type: 'sync.github', payload: { accountId: 'a1' } });
    const claimed = await claim(db, 'worker-1', 10, 60);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.type).toBe('sync.github');
    expect(claimed[0]?.payload).toEqual({ accountId: 'a1' });
  });

  it('두 워커가 동시에 claim해도 같은 job을 중복해서 가져가지 않는다', async () => {
    for (let i = 0; i < 20; i += 1) {
      await enqueue(db, { type: 'sync.github', payload: { i } });
    }

    const [a, b] = await Promise.all([
      claim(db, 'worker-a', 20, 60),
      claim(db, 'worker-b', 20, 60),
    ]);

    const ids = [...(a ?? []), ...(b ?? [])].map((j) => j.id);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });

  it('run_at이 미래인 job은 claim하지 않는다', async () => {
    await enqueue(db, {
      type: 'sync.github',
      runAt: new Date(Date.now() + 60_000),
    });
    const claimed = await claim(db, 'worker-1', 10, 60);
    expect(claimed).toHaveLength(0);
  });

  it('lease가 만료된 running job을 회수한다', async () => {
    const job = await enqueue(db, { type: 'sync.github' });
    await claim(db, 'worker-dead', 10, 60);

    // lease를 강제로 만료시킨다
    await db
      .update(schema.jobs)
      .set({ lockedAt: new Date(Date.now() - 120_000) })
      .where(eq(schema.jobs.id, job.id));

    const reclaimed = await claim(db, 'worker-alive', 10, 60);
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]?.id).toBe(job.id);
    expect(reclaimed[0]?.attempts).toBe(2);
  });

  it('claim은 attempts를 증가시킨다', async () => {
    await enqueue(db, { type: 'sync.github' });
    const claimed = await claim(db, 'worker-1', 10, 60);
    expect(claimed[0]?.attempts).toBe(1);
  });

  it('complete한 job은 다시 claim되지 않는다', async () => {
    const job = await enqueue(db, { type: 'sync.github' });
    await claim(db, 'worker-1', 10, 60);
    await complete(db, job.id);

    const again = await claim(db, 'worker-1', 10, 60);
    expect(again).toHaveLength(0);

    const [row] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(row?.status).toBe('succeeded');
  });

  it('maxAttempts에 도달하지 않은 실패는 pending으로 되돌린다', async () => {
    const job = await enqueue(db, { type: 'sync.github', maxAttempts: 3 });
    await claim(db, 'worker-1', 10, 60);
    await fail(db, job.id, '502 Bad Gateway');

    const [row] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(row?.status).toBe('pending');
    expect(row?.lastError).toBe('502 Bad Gateway');
    expect(row?.lockedBy).toBeNull();

    const again = await claim(db, 'worker-1', 10, 60);
    expect(again).toHaveLength(1);
  });

  it('maxAttempts에 도달한 실패는 failed로 확정하고 다시 claim하지 않는다', async () => {
    const job = await enqueue(db, { type: 'sync.github', maxAttempts: 1 });
    await claim(db, 'worker-1', 10, 60);
    await fail(db, job.id, '401 Unauthorized');

    const [row] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(row?.status).toBe('failed');

    const again = await claim(db, 'worker-1', 10, 60);
    expect(again).toHaveLength(0);
  });

  it('limit을 넘겨 claim하지 않는다', async () => {
    for (let i = 0; i < 5; i += 1) await enqueue(db, { type: 'sync.github' });
    const claimed = await claim(db, 'worker-1', 2, 60);
    expect(claimed).toHaveLength(2);
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

Run: `pnpm vitest run packages/db/src/jobs`
Expected: FAIL — `Cannot find module './queue.js'`

- [ ] **Step 4: 큐 구현**

`packages/db/src/jobs/queue.ts`:

```ts
import { sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import type { EnqueueOptions, JobRecord } from './types.js';

type JobRow = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

function toRecord(row: JobRow): JobRecord {
  return {
    id: row.id,
    type: row.type,
    payload: row.payload,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
  };
}

export async function enqueue(db: Db, options: EnqueueOptions): Promise<JobRecord> {
  const result = await db.execute<JobRow>(sql`
    INSERT INTO jobs (type, payload, run_at, max_attempts)
    VALUES (
      ${options.type},
      ${JSON.stringify(options.payload ?? {})}::jsonb,
      ${options.runAt ?? new Date()},
      ${options.maxAttempts ?? 3}
    )
    RETURNING id, type, payload, attempts, max_attempts
  `);
  const row = result.rows[0];
  if (!row) throw new Error('job enqueue가 행을 반환하지 않았습니다.');
  return toRecord(row);
}

export async function claim(
  db: Db,
  workerId: string,
  limit: number,
  leaseSeconds: number,
): Promise<JobRecord[]> {
  const result = await db.execute<JobRow>(sql`
    UPDATE jobs
    SET status     = 'running',
        locked_at  = now(),
        locked_by  = ${workerId},
        attempts   = attempts + 1,
        updated_at = now()
    WHERE id IN (
      SELECT id FROM jobs
      WHERE (status = 'pending' AND run_at <= now())
         OR (status = 'running'
             AND locked_at < now() - ${leaseSeconds} * interval '1 second')
      ORDER BY run_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING id, type, payload, attempts, max_attempts
  `);
  return result.rows.map(toRecord);
}

export async function complete(db: Db, jobId: string): Promise<void> {
  await db.execute(sql`
    UPDATE jobs
    SET status = 'succeeded', locked_at = NULL, locked_by = NULL, updated_at = now()
    WHERE id = ${jobId}
  `);
}

export async function fail(db: Db, jobId: string, error: string): Promise<void> {
  await db.execute(sql`
    UPDATE jobs
    SET status = CASE WHEN attempts >= max_attempts THEN 'failed'::job_status
                      ELSE 'pending'::job_status END,
        last_error = ${error},
        locked_at  = NULL,
        locked_by  = NULL,
        updated_at = now()
    WHERE id = ${jobId}
  `);
}
```

**`FOR UPDATE SKIP LOCKED`가 서브쿼리 안에 있어야 한다.** 바깥 `UPDATE`에 붙이면 잠금이 걸리지 않아 중복 claim이 발생한다. 이 배치를 바꾸지 않는다.

- [ ] **Step 5: 재export**

`packages/db/src/jobs/index.ts`:

```ts
export { claim, complete, enqueue, fail } from './queue.js';
export type { EnqueueOptions, JobRecord } from './types.js';
```

`packages/db/src/index.ts`에 추가:

```ts
export * from './jobs/index.js';
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `pnpm vitest run packages/db/src/jobs`
Expected: PASS — 9 tests

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: SKIP LOCKED 기반 job 큐 구현"
```

**게이트 통과 조건:** 9건 전부 통과. 특히 "두 워커가 동시에 claim" 테스트가 통과해야 한다. `SKIP LOCKED`가 서브쿼리 안에 있을 것.

---

## Task 4: worker 폴링 루프

**Files:**
- Create: `apps/worker/package.json`, `apps/worker/tsconfig.json`, `apps/worker/src/index.ts`, `apps/worker/src/runner.ts`
- Create: `apps/worker/src/runner.test.ts`

**Step 0: 패키지 설정** (나머지 Step보다 먼저)

- [ ] **0-1: 의존성과 빌드 도구를 설치한다**

```bash
pnpm --filter worker add @deployhub/db @deployhub/shared
pnpm --filter worker add -D tsup
```

`@deployhub/*`는 workspace 프로토콜(`workspace:*`)로 잡혀야 한다.

- [ ] **0-2: `apps/worker/package.json`을 구성한다**

Task 6의 compose가 `apps/worker/dist/index.js`를 실행하므로 번들 산출물 경로를 여기서 고정한다.

```json
{
  "name": "worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsup src/index.ts --format esm --out-dir dist --target node22",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **0-3: `apps/worker/tsconfig.json`을 만든다**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

**Interfaces:**
- Consumes: Task 3 → `claim`, `complete`, `fail`, `JobRecord`; Task 1 → `loadEnv`
- Produces:

```ts
export type JobHandler = (job: JobRecord) => Promise<void>;
export type HandlerRegistry = Record<string, JobHandler>;

export function createRunner(db: Db, handlers: HandlerRegistry, workerId: string): {
  runOnce: () => Promise<{ claimed: number; succeeded: number; failed: number }>;
};
```

`runOnce`를 분리하는 이유는 무한 루프를 테스트할 수 없기 때문이다. `index.ts`가 `runOnce`를 주기 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/worker/src/runner.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { startTestDb } from '@deployhub/db/test/helpers/pg.js';
import { enqueue, schema, type Db } from '@deployhub/db';
import { createRunner } from './runner.js';

let db: Db;
let stop: () => Promise<void>;

beforeAll(async () => {
  const started = await startTestDb();
  db = started.db;
  stop = started.stop;
}, 120_000);

afterAll(async () => { await stop(); });
beforeEach(async () => { await db.delete(schema.jobs); });

describe('runner', () => {
  it('등록된 핸들러로 job을 처리하고 succeeded로 만든다', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const job = await enqueue(db, { type: 'sync.github', payload: { id: 1 } });

    const runner = createRunner(db, { 'sync.github': handler }, 'worker-1');
    const result = await runner.runOnce();

    expect(result).toEqual({ claimed: 1, succeeded: 1, failed: 0 });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]?.[0]?.payload).toEqual({ id: 1 });

    const [row] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(row?.status).toBe('succeeded');
  });

  it('핸들러가 던지면 job을 실패 처리하고 루프는 계속된다', async () => {
    await enqueue(db, { type: 'sync.github', maxAttempts: 3 });
    await enqueue(db, { type: 'sync.github', maxAttempts: 3 });

    const handler = vi.fn().mockRejectedValue(new Error('boom'));
    const runner = createRunner(db, { 'sync.github': handler }, 'worker-1');
    const result = await runner.runOnce();

    expect(result).toEqual({ claimed: 2, succeeded: 0, failed: 2 });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('핸들러가 없는 type은 실패로 기록하고 사유를 남긴다', async () => {
    const job = await enqueue(db, { type: 'unknown.task', maxAttempts: 1 });
    const runner = createRunner(db, {}, 'worker-1');
    const result = await runner.runOnce();

    expect(result.failed).toBe(1);
    const [row] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(row?.status).toBe('failed');
    expect(row?.lastError).toMatch(/unknown\.task/);
  });

  it('처리할 job이 없으면 0을 반환한다', async () => {
    const runner = createRunner(db, {}, 'worker-1');
    expect(await runner.runOnce()).toEqual({ claimed: 0, succeeded: 0, failed: 0 });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm vitest run apps/worker`
Expected: FAIL — `Cannot find module './runner.js'`

- [ ] **Step 3: runner 구현**

`apps/worker/src/runner.ts`:

```ts
import { claim, complete, fail, type Db, type JobRecord } from '@deployhub/db';

export type JobHandler = (job: JobRecord) => Promise<void>;
export type HandlerRegistry = Record<string, JobHandler>;

export type RunResult = { claimed: number; succeeded: number; failed: number };

const BATCH_SIZE = 10;
const LEASE_SECONDS = 300;

export function createRunner(
  db: Db,
  handlers: HandlerRegistry,
  workerId: string,
): { runOnce: () => Promise<RunResult> } {
  async function runOnce(): Promise<RunResult> {
    const jobs = await claim(db, workerId, BATCH_SIZE, LEASE_SECONDS);
    let succeeded = 0;
    let failed = 0;

    for (const job of jobs) {
      const handler = handlers[job.type];
      if (!handler) {
        await fail(db, job.id, `등록된 핸들러가 없습니다: ${job.type}`);
        failed += 1;
        continue;
      }
      try {
        await handler(job);
        await complete(db, job.id);
        succeeded += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await fail(db, job.id, message);
        failed += 1;
      }
    }

    return { claimed: jobs.length, succeeded, failed };
  }

  return { runOnce };
}
```

한 job의 실패가 배치의 나머지를 막지 않는다. `for` 루프 안에서 개별 `try/catch`를 쓰는 이유다.

- [ ] **Step 4: 진입점 구현**

`apps/worker/src/index.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { createDb } from '@deployhub/db';
import { loadEnv } from '@deployhub/shared';
import { createRunner } from './runner.js';

const POLL_INTERVAL_MS = 5_000;

async function main(): Promise<void> {
  const env = loadEnv(process.env);
  const { db, close } = createDb(env.DATABASE_URL);
  const workerId = `worker-${randomUUID().slice(0, 8)}`;
  const runner = createRunner(db, {}, workerId);

  let running = true;
  const shutdown = (signal: string): void => {
    console.log(`[worker] ${signal} 수신. 현재 배치를 마치고 종료합니다.`);
    running = false;
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  console.log(`[worker] 시작 ${workerId}`);
  while (running) {
    try {
      const result = await runner.runOnce();
      if (result.claimed > 0) console.log('[worker]', result);
    } catch (error) {
      console.error('[worker] 배치 실패', error);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  await close();
  console.log('[worker] 종료');
}

void main();
```

핸들러 레지스트리가 비어 있는 것은 정상이다 — M1b의 GitHub Collector가 첫 핸들러를 등록한다.

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm vitest run apps/worker`
Expected: PASS — 4 tests

- [ ] **Step 6: 커밋**

```bash
git add -A
git commit -m "feat: worker 폴링 루프와 graceful shutdown"
```

**게이트 통과 조건:** 4건 통과. 한 job의 실패가 배치의 나머지를 막지 않을 것. SIGTERM 시 진행 중 배치를 마치고 종료할 것.

---

## Task 5: GitHub OAuth 인증과 화이트리스트

**Files:**
- Create: `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/tsconfig.json`
- Create: `apps/web/src/auth/allowlist.ts`, `apps/web/src/auth/allowlist.test.ts`

**Step 0: 패키지 설정** (나머지 Step보다 먼저)

- [ ] **0-1: 의존성을 설치한다**

```bash
pnpm --filter web add next react react-dom next-auth @deployhub/db @deployhub/shared
pnpm --filter web add -D @types/react @types/react-dom
```

- [ ] **0-2: `apps/web/tsconfig.json`을 만든다**

**여기가 Task 2 Step 0-2에서 패키지별 tsconfig로 바꿔둔 이유다.** web만 DOM과 JSX가 필요하고, 다른 패키지는 그것을 받으면 안 된다.

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "preserve",
    "composite": false,
    "noEmit": true,
    "allowJs": true,
    "incremental": true,
    "paths": { "@/*": ["./src/*"] },
    "plugins": [{ "name": "next" }]
  },
  "include": ["src", "next-env.d.ts", ".next/types/**/*.ts"]
}
```

`composite: false`와 `noEmit: true`로 덮어쓰는 이유는 Next.js가 자체 빌드 파이프라인을 쓰기 때문이다. 베이스의 `composite: true`를 그대로 두면 `tsc --noEmit`이 충돌한다.

- [ ] **0-3: `apps/web/package.json`에 스크립트를 넣는다**

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "typecheck": "tsc --noEmit"
}
```
- Create: `apps/web/src/auth/config.ts`
- Create: `apps/web/src/app/api/auth/[...nextauth]/route.ts`
- Create: `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx`
- Create: `apps/web/src/middleware.ts`
- Modify: `.env.example`, `packages/shared/src/env.ts` (인증 변수 추가)

**Interfaces:**
- Consumes: Task 1 → `loadEnv`; Task 2 → `schema.users`, `createDb`
- Produces:
  - `isAllowedLogin(login: string, rawAllowlist: string | undefined): boolean`
  - Auth.js `auth()` 헬퍼 — 이후 모든 서버 컴포넌트가 세션 확인에 사용

- [ ] **Step 1: 실패하는 화이트리스트 테스트 작성**

화이트리스트는 순수 함수로 분리해 DB·네트워크 없이 테스트한다. **fail closed가 핵심이다** — 목록이 비어 있으면 전부 거부한다. 설정 누락이 곧 전체 개방으로 이어지면 안 된다.

`apps/web/src/auth/allowlist.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isAllowedLogin } from './allowlist.js';

describe('isAllowedLogin', () => {
  it('목록에 있는 로그인을 허용한다', () => {
    expect(isAllowedLogin('gnghkim', 'gnghkim,someone')).toBe(true);
  });

  it('목록에 없는 로그인을 거부한다', () => {
    expect(isAllowedLogin('attacker', 'gnghkim,someone')).toBe(false);
  });

  it('대소문자를 구분하지 않는다', () => {
    expect(isAllowedLogin('GnGhKim', 'gnghkim')).toBe(true);
  });

  it('공백을 제거하고 비교한다', () => {
    expect(isAllowedLogin('someone', ' gnghkim , someone ')).toBe(true);
  });

  it('목록이 비어 있으면 전부 거부한다 (fail closed)', () => {
    expect(isAllowedLogin('gnghkim', '')).toBe(false);
  });

  it('목록이 undefined이면 전부 거부한다 (fail closed)', () => {
    expect(isAllowedLogin('gnghkim', undefined)).toBe(false);
  });

  it('빈 로그인은 거부한다', () => {
    expect(isAllowedLogin('', 'gnghkim')).toBe(false);
  });

  it('부분 일치를 허용하지 않는다', () => {
    expect(isAllowedLogin('gnghkim2', 'gnghkim')).toBe(false);
    expect(isAllowedLogin('nghki', 'gnghkim')).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm vitest run apps/web/src/auth`
Expected: FAIL — `Cannot find module './allowlist.js'`

- [ ] **Step 3: 화이트리스트 구현**

`apps/web/src/auth/allowlist.ts`:

```ts
export function isAllowedLogin(
  login: string,
  rawAllowlist: string | undefined,
): boolean {
  if (login.trim() === '') return false;
  if (rawAllowlist === undefined) return false;

  const allowed = rawAllowlist
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');

  if (allowed.length === 0) return false;
  return allowed.includes(login.trim().toLowerCase());
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run apps/web/src/auth`
Expected: PASS — 8 tests

- [ ] **Step 5: 환경변수 스키마 확장**

`packages/shared/src/env.ts`의 `Env`에 아래를 추가하고, `loadEnv`에서 `AUTH_SECRET`·`AUTH_GITHUB_ID`·`AUTH_GITHUB_SECRET`를 `requireString`으로 검증한다. `ALLOWED_GITHUB_LOGINS`는 **선택**으로 두되 값이 없으면 `isAllowedLogin`이 전부 거부한다.

```ts
export type Env = {
  DATABASE_URL: string;
  NODE_ENV: NodeEnv;
  AUTH_SECRET: string;
  AUTH_GITHUB_ID: string;
  AUTH_GITHUB_SECRET: string;
  ALLOWED_GITHUB_LOGINS: string | undefined;
};
```

`packages/shared/src/env.test.ts`에 케이스를 추가한다:

```ts
it('AUTH_SECRET이 없으면 변수명을 포함해 실패한다', () => {
  expect(() =>
    loadEnv({
      DATABASE_URL: 'postgres://u:p@localhost:5432/d',
      AUTH_GITHUB_ID: 'id',
      AUTH_GITHUB_SECRET: 'secret',
    }),
  ).toThrow(/AUTH_SECRET/);
});

it('ALLOWED_GITHUB_LOGINS는 없어도 로드된다', () => {
  const env = loadEnv({
    DATABASE_URL: 'postgres://u:p@localhost:5432/d',
    AUTH_SECRET: 's', AUTH_GITHUB_ID: 'id', AUTH_GITHUB_SECRET: 'secret',
  });
  expect(env.ALLOWED_GITHUB_LOGINS).toBeUndefined();
});
```

기존 테스트들도 새 필수 변수를 포함하도록 함께 고친다.

- [ ] **Step 6: Auth.js 설정**

`apps/web/src/auth/config.ts`:

```ts
import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import { eq } from 'drizzle-orm';
import { createDb, schema } from '@deployhub/db';
import { isAllowedLogin } from './allowlist.js';

const { db } = createDb(process.env.DATABASE_URL ?? '');

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [GitHub],
  session: { strategy: 'jwt' },
  callbacks: {
    async signIn({ profile }) {
      const login = typeof profile?.login === 'string' ? profile.login : '';
      if (!isAllowedLogin(login, process.env.ALLOWED_GITHUB_LOGINS)) {
        console.warn(`[auth] 허용되지 않은 로그인 거부: ${login || '(빈 값)'}`);
        return false;
      }

      const githubId = BigInt(profile?.id as number);
      await db
        .insert(schema.users)
        .values({
          githubId,
          githubLogin: login,
          name: typeof profile?.name === 'string' ? profile.name : null,
          email: typeof profile?.email === 'string' ? profile.email : null,
          avatarUrl: typeof profile?.avatar_url === 'string' ? profile.avatar_url : null,
          lastLoginAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.users.githubId,
          set: { githubLogin: login, lastLoginAt: new Date() },
        });
      return true;
    },
    async jwt({ token, profile }) {
      if (profile?.login) {
        const [user] = await db
          .select()
          .from(schema.users)
          .where(eq(schema.users.githubLogin, profile.login as string));
        if (user) token.userId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (typeof token.userId === 'string') session.user.id = token.userId;
      return session;
    },
  },
});
```

세션 전략을 JWT로 두는 이유는 사용자가 1~2명이라 세션 테이블을 유지할 이득이 없기 때문이다. `users` 행은 이후 `project_drafts.reviewed_by` 같은 FK를 위해 유지한다.

- [ ] **Step 7: 라우트·레이아웃·미들웨어**

`apps/web/src/app/api/auth/[...nextauth]/route.ts`:

```ts
import { handlers } from '@/auth/config';

export const { GET, POST } = handlers;
```

`apps/web/src/middleware.ts` — 인증되지 않은 요청을 로그인으로 보내되, 인증 경로 자체는 제외한다:

```ts
export { auth as middleware } from '@/auth/config';

export const config = {
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico).*)'],
};
```

`apps/web/src/app/page.tsx` — 로그인 확인용 최소 화면:

```tsx
import { auth } from '@/auth/config';

export default async function Home() {
  const session = await auth();
  return (
    <main>
      <h1>DeployHub</h1>
      <p>{session?.user?.name ?? '미인증'}</p>
    </main>
  );
}
```

`apps/web/next.config.ts`:

```ts
import type { NextConfig } from 'next';

const config: NextConfig = { output: 'standalone' };
export default config;
```

- [ ] **Step 8: `.env.example` 갱신**

```
POSTGRES_PASSWORD=
DATABASE_URL=
NODE_ENV=

AUTH_SECRET=
AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=
ALLOWED_GITHUB_LOGINS=
```

값을 넣지 않는다.

- [ ] **Step 9: 전체 검증**

Run: `pnpm typecheck && pnpm vitest run && pnpm --filter web build`
Expected: 타입 오류 0, 테스트 전부 통과, Next 빌드 성공(`.next/standalone` 생성)

- [ ] **Step 10: 커밋**

```bash
git add -A
git commit -m "feat: GitHub OAuth 인증과 로그인 화이트리스트"
```

**게이트 통과 조건:** 화이트리스트 8건 통과, 특히 **fail closed 2건**(빈 목록·undefined)이 통과할 것. `.env.example`에 실제 값이 없을 것. Next 빌드가 standalone을 생성할 것.

---

## Task 6: Dockerfile과 Compose 완성

**Files:**
- Create: `docker/Dockerfile`, `docker/Caddyfile`
- Modify: `docker/compose.yml` (web·worker·caddy 추가)
- Create: `docker/README.md` (기동 절차)

**Interfaces:**
- Consumes: Task 4 → `apps/worker` 빌드 산출물; Task 5 → `apps/web` standalone 산출물
- Produces: `deployhub:${TAG}` 단일 이미지. `command`로 web/worker 분기

- [ ] **Step 1: 멀티스테이지 Dockerfile 작성**

`docker/Dockerfile`:

```dockerfile
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
```

한 이미지에 web과 worker 산출물이 모두 들어간다(구축방안 4절). 분기는 compose의 `command`가 한다.

- [ ] **Step 2: Caddyfile 작성**

`docker/Caddyfile`:

```caddyfile
{
	email {$ACME_EMAIL}
}

{$HUB_DOMAIN} {
	encode gzip
	rate_limit {
		zone api {
			match {
				path /api/*
			}
			key    {remote_host}
			events 60
			window 1m
		}
		zone general {
			key    {remote_host}
			events 300
			window 1m
		}
	}
	reverse_proxy web:3000
}

# 설정된 호스트명과 일치하지 않는 요청(공인 IP 직접 접근 포함)은 끊는다.
:80 {
	abort
}

:443 {
	abort
}
```

마지막 두 블록이 구축방안 3.1의 "IP 직접 접근 차단"이다. 가비아 DNS에는 프록시 계층이 없어 공인 IP가 노출되므로 이 방어가 필요하다.

- [ ] **Step 3: compose 완성**

`docker/compose.yml`에 서비스를 추가한다. postgres는 Task 1에서 이미 정의했다.

```yaml
  web:
    image: deployhub:${TAG:-local}
    build: { context: .., dockerfile: docker/Dockerfile }
    container_name: deployhub-web
    restart: unless-stopped
    command: ["node", "apps/web/server.js"]
    env_file: [../.env]
    depends_on:
      postgres: { condition: service_healthy }
    networks: [deployhub]
    labels:
      deployhub.project: "deployhub"
      deployhub.component: "web"
      deployhub.environment: "production"

  worker:
    image: deployhub:${TAG:-local}
    container_name: deployhub-worker
    restart: unless-stopped
    command: ["node", "apps/worker/dist/index.js"]
    env_file: [../.env]
    depends_on:
      postgres: { condition: service_healthy }
    networks: [deployhub]
    labels:
      deployhub.project: "deployhub"
      deployhub.component: "worker"
      deployhub.environment: "production"

  caddy:
    image: caddy:2-alpine
    container_name: deployhub-caddy
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    environment:
      HUB_DOMAIN: ${HUB_DOMAIN:?HUB_DOMAIN required}
      ACME_EMAIL: ${ACME_EMAIL:?ACME_EMAIL required}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on: [web]
    networks: [deployhub]
```

`volumes`에 `caddy_data`, `caddy_config`를 추가한다. **web·worker·postgres에 `ports`를 넣지 않는다** — 외부 노출은 caddy의 80/443뿐이다(구축방안 3.1).

- [ ] **Step 4: 로컬 기동 검증**

Run:

```bash
cp .env.example .env
# .env에 로컬 테스트용 값을 채운다 (커밋하지 않는다)
docker compose -f docker/compose.yml build
docker compose -f docker/compose.yml up -d postgres web worker
docker compose -f docker/compose.yml ps
```

Expected: postgres `healthy`, web·worker `running`

Run: `docker compose -f docker/compose.yml logs worker | tail -5`
Expected: `[worker] 시작 worker-xxxxxxxx`

- [ ] **Step 5: 포트 노출 검증**

Run: `docker compose -f docker/compose.yml config | grep -A2 "ports:"`
Expected: `80`과 `443`만 나타난다. `5432`가 나오면 **실패**다.

- [ ] **Step 6: 마이그레이션 적용 절차 문서화**

`docker/README.md`에 기동 순서를 적는다 — 이미지 빌드 → postgres 기동 → 마이그레이션 적용(`pnpm --filter @deployhub/db exec drizzle-kit migrate`) → web·worker 기동 → caddy 기동.

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: 멀티스테이지 Dockerfile과 Compose 스택 구성"
```

**게이트 통과 조건:** 이미지 빌드 성공, worker 로그에 시작 메시지 출력, `docker compose config`에서 노출 포트가 80·443뿐, `.env`가 커밋되지 않았을 것.

---

## Self-Review

**1. 구축방안 M1 커버리지**

| 구축방안 M1 항목 | Task |
|---|---|
| pnpm workspace, 멀티스테이지 Dockerfile | 1, 6 |
| compose(web/worker/postgres/caddy), Caddy 레이트리밋 | 1, 6 |
| Drizzle 스키마 v1 (7개 테이블) | 2 |
| Auth.js GitHub OAuth + 화이트리스트 | 5 |
| `jobs` + SKIP LOCKED 폴링, worker | 3, 4 |
| Raycast 토큰 → Tailwind, Sidebar 레이아웃 | **M1b로 이월** |
| GitHub Collector | **M1b로 이월** |
| 저장소 기준 자동 그룹핑 | **M1b로 이월** |
| 프로젝트·구성요소 CRUD, 목록, 상세 | **M1b로 이월** |

이월 항목은 의도적 분할이다. 스키마와 큐가 게이트를 통과한 뒤 확정된 타입 위에서 M1b를 계획한다.

**UFW 80/443** 은 서버 프로비저닝 작업이라 코드 Task에 포함하지 않는다. 실제 VPS 배포 시점에 별도 체크리스트로 다룬다.

**2. 타입 일관성 확인**

- `Db` — Task 2에서 정의, Task 3·4·5가 소비 ✓
- `JobRecord` — Task 3에서 정의(`maxAttempts` 카멜케이스), Task 4의 `JobHandler`가 소비 ✓
- `loadEnv`/`Env` — Task 1에서 정의, Task 5에서 필드 확장. 확장 시 기존 테스트를 함께 고치라고 Step 5에 명시 ✓
- `isAllowedLogin(login, rawAllowlist)` — Task 5 내부에서만 소비 ✓
- `schema.users.githubId`가 `bigint` mode `bigint`이므로 Task 5에서 `BigInt(...)` 변환 명시 ✓

**3. 위험 지점**

- Task 3의 `FOR UPDATE SKIP LOCKED` 위치. 서브쿼리 밖으로 나가면 테스트는 통과할 수도 있으나 실제 동시성에서 깨진다. 검토 시 **눈으로 확인**한다.
- Task 5의 fail-closed. 화이트리스트가 비었을 때 허용으로 뒤집히면 공개 저장소에 노출된 시스템이 전면 개방된다. 테스트 2건이 이를 고정한다.
- Task 6의 포트 노출. Step 5가 자동 확인하지만 검토 시 `compose.yml`을 직접 읽는다.

---

## Execution

기본 실행 방식(subagent-driven / inline) 대신 **orca orchestration + codex 위임**을 사용한다.

```
Task N  →  orca worktree 생성  →  codex 디스패치
        →  검증 명령 실행 (typecheck / vitest / build / compose config)
        →  Claude 설계 부합 검토
             ├ 설계 오해·누락  → 지적과 함께 codex 반려
             └ 오타·포맷       → Claude가 수정 후 보고
        →  게이트 통과  →  main 병합  →  Task N+1
```

Task 1 → 2 → 3 → 4 → 5 → 6 순서로 진행한다. Task 2가 Task 3·4·5의 선행이고, Task 4·5가 Task 6의 선행이므로 병렬화하지 않는다.
