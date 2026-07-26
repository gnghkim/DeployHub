# DeployHub M1b (화면과 수집) Implementation Plan

> **For agentic workers:** 이 계획은 orca orchestration으로 codex 워커에게 카드 단위 위임된다. 각 Task는 격리된 worktree에서 수행하고, 검증 명령이 모두 통과한 뒤 Claude의 설계 부합 검토를 거쳐 main에 병합한다.

**Goal:** M1a가 세운 기반 위에 화면과 GitHub 수집을 얹어, 저장소 전체가 목록에 뜨고 마지막 커밋·워크플로 결과가 보이며 프로젝트 단위로 묶인 상태에 도달한다.

**Architecture:** Next.js App Router의 서버 컴포넌트로 조회하고 Server Actions로 변경한다. 외부 수집은 `packages/collectors`가 `ProviderCollector` 인터페이스를 통해 수행하며, worker가 `jobs` 큐로 주기 실행한다. UI는 `DESIGN-raycast.md`의 토큰을 Tailwind v4 `@theme`로 옮겨 직접 구현한다.

**Tech Stack:** Next.js 16 App Router · React 19 · Tailwind CSS 4 (CSS-first) · Zod 4 · Octokit 22 · Drizzle ORM · Vitest · Testcontainers

**선행 문서:** `docs/superpowers/specs/2026-07-26-deployhub-구축방안.md`, `docs/superpowers/plans/2026-07-26-deployhub-m1a-기반.md`

---

## M1a에서 확정된 전제

이 계획은 아래를 이미 있는 것으로 가정한다. 다시 만들지 않는다.

| 항목 | 확정 내용 |
|---|---|
| 버전 | Node 22.23.1 · pnpm 9.15.0 · **TypeScript 6.0.3** · Vitest 4.1.10 · PostgreSQL 17.10 · Next 16.2.12 · next-auth 5.0.0-beta.32 |
| 워크스페이스 | `apps/web`, `apps/worker`, `packages/shared`, `packages/db` |
| typecheck | 루트 `pnpm -r typecheck`, 패키지별 `tsc --noEmit` |
| tsconfig | `tsconfig.base.json`에 `composite`·`declaration` **없음**. 패키지 tsconfig는 `noEmit` + `include`만 |
| import | 상대경로에 **확장자를 붙이지 않는다** (`moduleResolution: "Bundler"`) |
| 내부 패키지 | `main`/`types`가 `./src/index.ts`. 설치 시 `workspace:*` 명시 필수 |
| DB 스키마 | 테이블 7개 (`users`, `projects`, `components`, `provider_accounts`, `resources`, `component_resources`, `jobs`) |
| job 큐 | `enqueue`/`claim`/`complete`/`fail`. **시간은 DB 시계(`now()`)만 사용** |
| 인증 | Auth.js GitHub OAuth + `isAllowedLogin` fail-closed |
| 컨테이너 | web/worker 동일 이미지, 공개 포트 80/443뿐 |

---

## Global Constraints

M1a의 Global Constraints를 그대로 승계하고 아래를 더한다.

- **상대 import에 확장자를 붙이지 않는다.** `./foo`이지 `./foo.js`가 아니다. M1a Task 5에서 확장자를 전부 제거했으므로 되돌리지 마라.
- **의존성 설치는 각 Task 안에서.** 내부 패키지는 `workspace:*`를 명시한다. 예: `pnpm --filter web add '@deployhub/db@workspace:*'`
- **`pnpm --filter <name>`은 대상 `package.json`이 있어야 성립한다.** 새 패키지는 `package.json` → `tsconfig.json` → 설치 순으로 만든다.
- **새 패키지의 `tsconfig.json`은 아래 형태로 통일한다.** `rootDir`/`outDir`을 넣지 않는다.
  ```json
  { "extends": "../../tsconfig.base.json", "compilerOptions": { "noEmit": true }, "include": ["src", "test"] }
  ```
- **비밀값을 커밋하지 않는다.** `.env.example`에는 변수 이름만.
- **Provider 토큰을 평문으로 저장하지 않는다.** DB에는 AES-256-GCM 암호문만 들어간다.
- **환경변수 값을 수집·저장하지 않는다.** GitHub Collector는 이름과 메타데이터만 다룬다(구축방안 R4).
- **커밋 메시지:** Conventional Commits.

---

## 구축방안 대비 결정

| 항목 | 구축방안 | M1b 결정 | 근거 |
|---|---|---|---|
| shadcn/ui | 9.1에 명시 | **쓰지 않는다** | `DESIGN-raycast.md`는 그림자 없음·1px hairline·특정 Surface 단계를 요구한다. shadcn 기본값을 그만큼 덮어쓰면 남는 이득이 없다. 필요한 원시 컴포넌트 5개를 직접 만든다 |
| TanStack Table | 9.1에 명시 | **M1b 제외** | 20개 규모에 정렬·필터는 서버 쿼리로 충분하다. 가상화가 필요해지면 그때 |
| React Flow · Recharts | 9.1에 명시 | **M1b 제외** | 구축방안이 이미 M5 이후로 미룬 항목 |
| `projects.repository` | 스키마에 없음 | **컬럼 추가** | 구축방안 8절이 "저장소가 모든 것의 조인 키"라고 했으나 `projects`에 저장소 필드가 없어 매칭 대상이 없다. Task 2에서 마이그레이션으로 추가한다 |

---

## File Structure

```
packages/
├─ shared/src/
│  ├─ crypto.ts               AES-256-GCM 암복호화 (신규)
│  └─ crypto.test.ts
└─ collectors/                (신규 패키지)
   ├─ package.json
   ├─ tsconfig.json
   └─ src/
      ├─ index.ts             재export
      ├─ types.ts             ProviderCollector · ExternalResource
      ├─ github/
      │  ├─ index.ts          GithubCollector
      │  ├─ normalize.ts      API 응답 → ExternalResource
      │  └─ normalize.test.ts 픽스처 기반 스냅샷
      └─ test/fixtures/       GitHub API 응답 픽스처

apps/web/src/
├─ app/
│  ├─ globals.css             Tailwind + Raycast 토큰
│  ├─ layout.tsx              Sidebar + Topbar 셸
│  ├─ page.tsx                Overview
│  ├─ projects/
│  │  ├─ page.tsx             목록
│  │  ├─ new/page.tsx         등록
│  │  └─ [slug]/page.tsx      상세 (구성요소 포함)
│  ├─ providers/page.tsx      Provider 계정 등록·동기화
│  └─ resources/page.tsx      수집 자원 · Unlinked · 그룹핑 확인
├─ components/ui/
│  ├─ card.tsx  button.tsx  badge.tsx  status-dot.tsx  table.tsx  input.tsx
├─ components/shell/
│  ├─ sidebar.tsx  topbar.tsx
├─ lib/
│  ├─ db.ts                   요청 스코프 db 핸들
│  └─ schemas.ts              Zod 입력 스키마
└─ actions/
   ├─ projects.ts  components.ts  providers.ts  links.ts

apps/worker/src/
└─ handlers/
   ├─ index.ts                핸들러 레지스트리
   └─ github-sync.ts          github.sync job 핸들러

packages/db/src/
├─ schema/projects.ts         repository 컬럼 추가
└─ queries/                   조회 헬퍼 (신규)
   ├─ projects.ts  resources.ts
```

---

## Task 1: 디자인 토큰과 앱 셸

**Files:**
- Create: `apps/web/postcss.config.mjs`, `apps/web/src/app/globals.css`
- Create: `apps/web/src/components/ui/{card,button,badge,status-dot,table,input}.tsx`
- Create: `apps/web/src/components/shell/{sidebar,topbar}.tsx`
- Create: `apps/web/src/components/ui/tokens.test.ts`
- Modify: `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx`

**Interfaces:**
- Consumes: M1a의 `auth()` (`@/auth/config`)
- Produces:
  - `<Card>`, `<Button variant="primary"|"secondary"|"tertiary">`, `<Badge tone="success"|"warning"|"error"|"info"|"neutral">`, `<StatusDot tone=...>`, `<Table>` 계열, `<Input>`
  - `<Sidebar>`, `<Topbar title={string}>`
  - CSS 토큰: `--color-canvas`, `--color-surface`, `--color-surface-elevated`, `--color-surface-card`, `--color-ink`, `--color-body`, `--color-mute`, `--color-ash`, `--color-hairline`, `--color-success`, `--color-warning`, `--color-error`, `--color-info`

- [ ] **Step 1: Tailwind v4 설치**

Tailwind 4는 CSS-first 설정이다. `tailwind.config.ts`를 만들지 마라.

```bash
pnpm --filter web add -D tailwindcss @tailwindcss/postcss
```

`apps/web/postcss.config.mjs`:

```js
export default {
  plugins: { '@tailwindcss/postcss': {} },
};
```

- [ ] **Step 2: 토큰 정의**

`apps/web/src/app/globals.css` — 값은 구축방안 17.2에서 그대로 가져온다. 임의로 바꾸지 마라.

```css
@import "tailwindcss";

@theme {
  --color-canvas: #07080a;
  --color-surface: #0d0d0d;
  --color-surface-elevated: #101111;
  --color-surface-card: #121212;

  --color-ink: #f4f4f6;
  --color-body: #cdcdcd;
  --color-mute: #9c9c9d;
  --color-ash: #6a6b6c;

  --color-hairline: #242728;

  --color-success: #59d499;
  --color-warning: #ffc533;
  --color-error: #ff6161;
  --color-info: #57c1ff;

  --radius-badge: 4px;
  --radius-row: 6px;
  --radius-button: 8px;
  --radius-card: 10px;
  --radius-modal: 16px;

  --font-sans: Inter, "Noto Sans KR", system-ui, sans-serif;
}

:root { color-scheme: dark; }

html, body {
  background-color: var(--color-canvas);
  color: var(--color-body);
  font-family: var(--font-sans);
  font-feature-settings: "calt", "kern", "liga";
}
```

**그림자를 쓰지 않는다.** 깊이는 Surface 단계와 1px hairline으로만 표현한다(구축방안 17.4).

> **TDD 순서 주의:** 아래 Step 3의 테스트를 Step 2보다 **먼저** 작성해도 좋다. Step 2가 CSS를 이미 만들어 놓으면 Step 4의 RED 확인이 성립하지 않는다. 이 계획서의 M1b Task 1은 실제 실행에서 이 순서 문제가 드러났으므로, 뒤따르는 Task에서는 테스트를 먼저 쓰고 구현을 나중에 한다.

- [ ] **Step 3: 실패하는 토큰 테스트 작성**

토큰이 조용히 바뀌는 것을 막는다. 색상은 상태 표시의 근거이므로 회귀하면 화면 전체의 의미가 흔들린다.

`apps/web/src/components/ui/tokens.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');

const REQUIRED: Record<string, string> = {
  '--color-canvas': '#07080a',
  '--color-surface': '#0d0d0d',
  '--color-surface-elevated': '#101111',
  '--color-surface-card': '#121212',
  '--color-ink': '#f4f4f6',
  '--color-body': '#cdcdcd',
  '--color-mute': '#9c9c9d',
  '--color-ash': '#6a6b6c',
  '--color-hairline': '#242728',
  '--color-success': '#59d499',
  '--color-warning': '#ffc533',
  '--color-error': '#ff6161',
  '--color-info': '#57c1ff',
};

describe('Raycast 디자인 토큰', () => {
  for (const [name, value] of Object.entries(REQUIRED)) {
    it(`${name} 이 ${value} 로 정의된다`, () => {
      expect(css).toContain(`${name}: ${value};`);
    });
  }

  it('그림자를 쓰지 않는다', () => {
    expect(css).not.toMatch(/box-shadow:\s*(?!none)/);
  });
});
```

- [ ] **Step 4: 테스트가 실패하는지 확인**

Run: `pnpm vitest run apps/web/src/components`
Expected: FAIL — `globals.css` 가 없거나 토큰이 비어 있음

- [ ] **Step 5: 원시 컴포넌트 구현**

여섯 파일 모두 서버 컴포넌트로 만든다(`'use client'` 금지 — 상태가 없다).

`badge.tsx` 예시. 나머지도 같은 방식으로 토큰만 사용한다.

```tsx
import type { ReactNode } from 'react';

const TONES = {
  success: 'text-[var(--color-success)]',
  warning: 'text-[var(--color-warning)]',
  error: 'text-[var(--color-error)]',
  info: 'text-[var(--color-info)]',
  neutral: 'text-[var(--color-mute)]',
} as const;

export type Tone = keyof typeof TONES;

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-[var(--radius-badge)] border border-[var(--color-hairline)] bg-[var(--color-surface-elevated)] px-1.5 py-0.5 text-xs ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
```

규격은 구축방안 17.5·17.6을 따른다 — Primary Button은 흰 배경·검은 글자·높이 36px·radius 8px, Card는 `#0d0d0d`에 1px `#242728`·radius 10px·padding 16~24px, Table Row는 기본 투명에 hover·선택 시 `#121212`.

- [ ] **Step 6: 앱 셸 구현**

`sidebar.tsx` — 폭 240px 고정. 네비게이션 항목은 구축방안 16.1을 따르되 M1b에 존재하는 것만 활성화하고 나머지는 비활성 표시한다.

```
활성:   Overview · Projects · Providers · Resources
비활성: Infrastructure · Deployments · Monitors · Domains · Alerts · Documents · Settings
```

`layout.tsx` — `globals.css`를 import하고 Sidebar + main을 배치한다. Page Padding 24~32px, Section Gap 24~32px(구축방안 17.7).

- [ ] **Step 7: 테스트 통과 확인**

Run: `pnpm vitest run apps/web/src/components`
Expected: PASS — 14 tests

- [ ] **Step 8: 빌드와 타입체크**

Run: `pnpm typecheck && pnpm --filter web build`
Expected: exit 0, `.next/standalone` 생성

- [ ] **Step 9: 커밋**

```bash
git add -A && git commit -m "feat: Raycast 디자인 토큰과 앱 셸"
```

**게이트 통과 조건:** 토큰 테스트 14건 통과, 빌드 성공, `tailwind.config.ts`가 없을 것(v4는 CSS-first), 그림자 미사용.

---

## Task 2: 프로젝트 CRUD

**Files:**
- Modify: `packages/db/src/schema/projects.ts` (repository 컬럼)
- Create: `drizzle/0001_*.sql` (마이그레이션)
- Create: `packages/db/src/queries/projects.ts`
- Create: `apps/web/src/lib/{db,schemas}.ts`
- Create: `apps/web/src/actions/projects.ts`
- Create: `apps/web/src/app/projects/{page.tsx,new/page.tsx,[slug]/page.tsx}`
- Create: `apps/web/src/lib/schemas.test.ts`
- Create: `packages/db/src/queries/projects.test.ts`

**Interfaces:**
- Consumes: Task 1의 UI 컴포넌트, M1a의 `schema.projects`
- Produces:
  - `schema.projects.repository` — `text('repository')`, nullable, `owner/name` 형식
  - `listProjects(db): Promise<ProjectRow[]>`, `getProjectBySlug(db, slug): Promise<ProjectDetail | undefined>`
  - `projectInputSchema` (Zod) — `name`, `slug`, `description?`, `status`, `lifecycle`, `importance`, `owner?`, `repository?`
  - Server Actions: `createProject(formData)`, `updateProject(id, formData)`, `archiveProject(id)`

- [ ] **Step 1: 스키마에 repository 컬럼 추가**

구축방안 8절의 "저장소가 모든 것의 조인 키"를 성립시키는 컬럼이다. Task 5의 매칭이 이 값을 쓴다.

`packages/db/src/schema/projects.ts`의 `projects` 정의에 추가:

```ts
    repository: text('repository'),
```

그리고 테이블 정의 끝의 인덱스 배열에 추가:

```ts
    index('projects_repository_idx').on(t.repository),
```

**unique로 만들지 마라.** 모노레포 하나에 여러 프로젝트가 대응할 수 있다.

- [ ] **Step 2: 마이그레이션 생성**

Run: `pnpm --filter @deployhub/db exec drizzle-kit generate`
Expected: `drizzle/0001_*.sql` 생성, `ALTER TABLE "projects" ADD COLUMN "repository" text` 포함

- [ ] **Step 3: 실패하는 Zod 스키마 테스트 작성**

`apps/web/src/lib/schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { projectInputSchema } from './schemas';

const valid = {
  name: 'LinkVault',
  slug: 'linkvault',
  status: 'active',
  lifecycle: 'production',
  importance: 3,
};

describe('projectInputSchema', () => {
  it('유효한 입력을 통과시킨다', () => {
    expect(projectInputSchema.parse(valid)).toMatchObject(valid);
  });

  it('slug 는 소문자·숫자·하이픈만 허용한다', () => {
    expect(() => projectInputSchema.parse({ ...valid, slug: 'Link Vault' })).toThrow();
    expect(() => projectInputSchema.parse({ ...valid, slug: 'link_vault' })).toThrow();
    expect(projectInputSchema.parse({ ...valid, slug: 'link-vault-2' }).slug).toBe('link-vault-2');
  });

  it('repository 는 owner/name 형식만 허용한다', () => {
    expect(projectInputSchema.parse({ ...valid, repository: 'ktgo/workwiki' }).repository).toBe('ktgo/workwiki');
    expect(() => projectInputSchema.parse({ ...valid, repository: 'workwiki' })).toThrow();
    expect(() => projectInputSchema.parse({ ...valid, repository: 'a/b/c' })).toThrow();
  });

  it('status 와 lifecycle 은 허용 목록 밖 값을 거부한다', () => {
    expect(() => projectInputSchema.parse({ ...valid, status: 'zombie' })).toThrow();
    expect(() => projectInputSchema.parse({ ...valid, lifecycle: 'legacy' })).toThrow();
  });

  it('importance 는 1~5 범위만 허용한다', () => {
    expect(() => projectInputSchema.parse({ ...valid, importance: 0 })).toThrow();
    expect(() => projectInputSchema.parse({ ...valid, importance: 6 })).toThrow();
  });

  it('빈 문자열 repository 는 undefined 로 정규화한다', () => {
    expect(projectInputSchema.parse({ ...valid, repository: '' }).repository).toBeUndefined();
  });
});
```

- [ ] **Step 4: 테스트가 실패하는지 확인**

Run: `pnpm vitest run apps/web/src/lib`
Expected: FAIL — `Cannot find module './schemas'`

- [ ] **Step 5: Zod 설치와 스키마 구현**

```bash
pnpm --filter web add zod
```

`apps/web/src/lib/schemas.ts`:

```ts
import { z } from 'zod';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REPO = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

export const projectInputSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().regex(SLUG, 'slug는 소문자·숫자·하이픈만 사용합니다.'),
  description: z.preprocess(emptyToUndefined, z.string().max(500).optional()),
  status: z.enum(['active', 'paused', 'maintenance', 'archived']),
  lifecycle: z.enum(['experimental', 'development', 'production', 'deprecated']),
  importance: z.coerce.number().int().min(1).max(5),
  owner: z.preprocess(emptyToUndefined, z.string().max(100).optional()),
  repository: z.preprocess(emptyToUndefined, z.string().regex(REPO, 'owner/name 형식이어야 합니다.').optional()),
});

export type ProjectInput = z.infer<typeof projectInputSchema>;
```

- [ ] **Step 6: 테스트 통과 확인**

Run: `pnpm vitest run apps/web/src/lib`
Expected: PASS — 6 tests

- [ ] **Step 7: 실패하는 조회 테스트 작성**

`packages/db/src/queries/projects.test.ts` — M1a의 `startTestDb` 헬퍼를 그대로 쓴다.

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDb } from '../../test/helpers/pg';
import { schema, type Db } from '../index';
import { getProjectBySlug, listProjects } from './projects';

let db: Db;
let stop: () => Promise<void>;

beforeAll(async () => {
  const s = await startTestDb();
  db = s.db;
  stop = s.stop;
}, 120_000);
afterAll(async () => { await stop(); });
beforeEach(async () => { await db.delete(schema.projects); });

describe('프로젝트 조회', () => {
  it('보관되지 않은 프로젝트만 목록에 넣는다', async () => {
    await db.insert(schema.projects).values([
      { name: 'A', slug: 'a' },
      { name: 'B', slug: 'b', archivedAt: new Date() },
    ]);
    const rows = await listProjects(db);
    expect(rows.map((r) => r.slug)).toEqual(['a']);
  });

  it('slug 로 상세를 가져오고 구성요소를 함께 담는다', async () => {
    const [p] = await db.insert(schema.projects).values({ name: 'A', slug: 'a' }).returning();
    if (!p) throw new Error('insert 실패');
    await db.insert(schema.components).values({
      projectId: p.id, name: 'web', slug: 'web', componentType: 'frontend', framework: 'nextjs',
    });

    const detail = await getProjectBySlug(db, 'a');
    expect(detail?.name).toBe('A');
    expect(detail?.components).toHaveLength(1);
    expect(detail?.components[0]?.framework).toBe('nextjs');
  });

  it('없는 slug 는 undefined 를 돌려준다', async () => {
    expect(await getProjectBySlug(db, 'nope')).toBeUndefined();
  });

  it('repository 값을 저장하고 돌려준다', async () => {
    await db.insert(schema.projects).values({ name: 'A', slug: 'a', repository: 'ktgo/a' });
    const detail = await getProjectBySlug(db, 'a');
    expect(detail?.repository).toBe('ktgo/a');
  });
});
```

- [ ] **Step 8: 테스트가 실패하는지 확인**

Run: `pnpm vitest run packages/db/src/queries`
Expected: FAIL — `Cannot find module './projects'`

- [ ] **Step 9: 조회 헬퍼 구현**

`packages/db/src/queries/projects.ts`:

```ts
import { asc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../client';
import { components, projects } from '../schema/projects';

export type ProjectRow = typeof projects.$inferSelect;
export type ComponentRow = typeof components.$inferSelect;
export type ProjectDetail = ProjectRow & { components: ComponentRow[] };

export async function listProjects(db: Db): Promise<ProjectRow[]> {
  return db.select().from(projects).where(isNull(projects.archivedAt)).orderBy(asc(projects.name));
}

export async function getProjectBySlug(db: Db, slug: string): Promise<ProjectDetail | undefined> {
  const [project] = await db.select().from(projects).where(eq(projects.slug, slug));
  if (!project) return undefined;
  const rows = await db
    .select()
    .from(components)
    .where(eq(components.projectId, project.id))
    .orderBy(asc(components.name));
  return { ...project, components: rows };
}
```

`packages/db/src/index.ts`에 재export를 추가한다:

```ts
export * from './queries/projects';
```

- [ ] **Step 10: 테스트 통과 확인**

Run: `pnpm vitest run packages/db/src/queries`
Expected: PASS — 4 tests

- [ ] **Step 11: Server Actions와 화면 구현**

`apps/web/src/lib/db.ts` — 요청마다 새 풀을 만들지 않도록 모듈 스코프에 하나만 둔다:

```ts
import { createDb } from '@deployhub/db';

const { db } = createDb(process.env.DATABASE_URL ?? '');
export { db };
```

`apps/web/src/actions/projects.ts` — 모든 Action은 `auth()`로 세션을 먼저 확인하고, 없으면 즉시 던진다. Zod 실패는 필드별 오류 메시지로 돌려준다. 성공 시 `revalidatePath`.

화면 세 개:
- `projects/page.tsx` — 구축방안 16.3의 표. 열: 프로젝트 · 구성 · 상태 · Lifecycle · 저장소 · 최근 변경
- `projects/new/page.tsx` — 등록 폼
- `projects/[slug]/page.tsx` — Overview 섹션 + 구성요소 섹션(Task 3에서 채운다)

- [ ] **Step 12: 전체 검증**

Run: `pnpm typecheck && pnpm vitest run && pnpm --filter web build`
Expected: 타입 오류 0, 테스트 42건(기존 32 + 토큰 14 - 중복 없음 = 실제 수치는 실행 결과를 따른다), 빌드 성공

> **주의:** 테스트 수는 실행 결과를 그대로 보고하라. 계획서의 예상치와 다르면 계획서가 틀린 것이니 실제 수치를 적고 넘어간다.

- [ ] **Step 13: 커밋**

```bash
git add -A && git commit -m "feat: 프로젝트 CRUD와 repository 컬럼"
```

**게이트 통과 조건:** 마이그레이션이 `repository` 컬럼을 추가하고 unique가 아닐 것. Zod 6건·조회 4건 통과. Server Action이 세션 없이 실행되지 않을 것.

---

## Task 3: 구성요소 CRUD

**Files:**
- Create: `apps/web/src/actions/components.ts`
- Create: `apps/web/src/app/projects/[slug]/components/new/page.tsx`
- Modify: `apps/web/src/app/projects/[slug]/page.tsx`
- Modify: `apps/web/src/lib/schemas.ts`, `apps/web/src/lib/schemas.test.ts`

**Interfaces:**
- Consumes: Task 2의 `getProjectBySlug`, `db`, UI 컴포넌트
- Produces:
  - `componentInputSchema` — `name`, `slug`, `componentType`, `framework?`, `runtime?`, `language?`, `criticality`
  - Server Actions: `createComponent(projectId, formData)`, `updateComponent(id, formData)`, `deleteComponent(id)`

- [ ] **Step 1: 실패하는 스키마 테스트 추가**

`apps/web/src/lib/schemas.test.ts`에 추가:

```ts
import { componentInputSchema } from './schemas';

describe('componentInputSchema', () => {
  const valid = { name: 'web', slug: 'web', componentType: 'frontend', criticality: 3 };

  it('유효한 입력을 통과시킨다', () => {
    expect(componentInputSchema.parse(valid)).toMatchObject(valid);
  });

  it('component_type 은 스키마 enum 11종만 허용한다', () => {
    expect(() => componentInputSchema.parse({ ...valid, componentType: 'gateway' })).toThrow();
    expect(componentInputSchema.parse({ ...valid, componentType: 'worker' }).componentType).toBe('worker');
  });

  it('framework·runtime·language 는 선택이며 빈 문자열은 undefined 가 된다', () => {
    const parsed = componentInputSchema.parse({ ...valid, framework: '', runtime: 'nodejs' });
    expect(parsed.framework).toBeUndefined();
    expect(parsed.runtime).toBe('nodejs');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm vitest run apps/web/src/lib`
Expected: FAIL — `componentInputSchema` 미정의

- [ ] **Step 3: 스키마 구현**

`apps/web/src/lib/schemas.ts`에 추가한다. `componentType`의 11종은 M1a 스키마의 `componentType` pgEnum과 **정확히 같아야 한다**. 임의로 늘리거나 줄이지 마라.

```ts
export const COMPONENT_TYPES = [
  'frontend', 'backend', 'api', 'worker', 'scheduler', 'database',
  'authentication', 'storage', 'cache', 'queue', 'monitoring',
] as const;

export const componentInputSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().regex(SLUG, 'slug는 소문자·숫자·하이픈만 사용합니다.'),
  componentType: z.enum(COMPONENT_TYPES),
  framework: z.preprocess(emptyToUndefined, z.string().max(50).optional()),
  runtime: z.preprocess(emptyToUndefined, z.string().max(50).optional()),
  language: z.preprocess(emptyToUndefined, z.string().max(50).optional()),
  criticality: z.coerce.number().int().min(1).max(5),
});

export type ComponentInput = z.infer<typeof componentInputSchema>;
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run apps/web/src/lib`
Expected: PASS — 9 tests (프로젝트 6 + 구성요소 3)

- [ ] **Step 5: Server Actions와 화면**

`actions/components.ts` — Task 2와 동일한 규칙(세션 확인 → Zod → DB → `revalidatePath`). `slug`는 `(project_id, slug)` unique이므로 중복 시 사용자에게 읽을 수 있는 오류를 돌려준다.

프로젝트 상세의 구성요소 섹션 — 구축방안 16.4를 따라 각 구성요소의 기술·타입·상태를 표로 보여준다. 열: 이름 · 타입 · Framework · Runtime · Language · 중요도.

- [ ] **Step 6: 전체 검증**

Run: `pnpm typecheck && pnpm vitest run && pnpm --filter web build`
Expected: 전부 통과

- [ ] **Step 7: 커밋**

```bash
git add -A && git commit -m "feat: 구성요소 CRUD"
```

**게이트 통과 조건:** `COMPONENT_TYPES` 11종이 DB enum과 정확히 일치할 것. 스키마 테스트 9건 통과.

---

## Task 4: 토큰 암호화와 GitHub Collector

이 Task의 핵심은 **토큰이 평문으로 어디에도 남지 않는 것**이다. 저장소가 공개이고 시스템이 프록시 없이 노출되므로(구축방안 3.2) 유출 경로를 코드로 막는다.

**Files:**
- Create: `packages/shared/src/crypto.ts`, `packages/shared/src/crypto.test.ts`
- Create: `packages/collectors/{package.json,tsconfig.json}`
- Create: `packages/collectors/src/{index.ts,types.ts}`
- Create: `packages/collectors/src/github/{index.ts,normalize.ts,normalize.test.ts}`
- Create: `packages/collectors/test/fixtures/*.json`
- Create: `apps/worker/src/handlers/{index.ts,github-sync.ts}`
- Create: `apps/web/src/actions/providers.ts`, `apps/web/src/app/providers/page.tsx`
- Modify: `packages/shared/src/{index.ts,env.ts}`, `apps/worker/src/index.ts`, `.env.example`

**Interfaces:**
- Consumes: M1a의 `enqueue`/`claim`, `schema.providerAccounts`, `schema.resources`
- Produces:

```ts
// packages/shared
export function loadEncryptionKey(raw: string | undefined): Buffer;
export function encrypt(plaintext: string, key: Buffer): string;   // "iv.tag.data" base64
export function decrypt(payload: string, key: Buffer): string;

// packages/collectors
export type ExternalResource = {
  provider: 'github' | 'vercel' | 'supabase' | 'hostinger' | 'docker';
  externalId: string;
  resourceType: 'github_repository' | 'vercel_project' | 'docker_container' | string;
  name: string;
  status?: string;
  region?: string;
  url?: string;
  metadata: Record<string, unknown>;
  observedAt: string;
};

export type ConnectionResult = { ok: true; account: string } | { ok: false; error: string };

export interface ProviderCollector {
  readonly provider: ExternalResource['provider'];
  testConnection(): Promise<ConnectionResult>;
  listResources(): Promise<ExternalResource[]>;
}

export function createGithubCollector(token: string): ProviderCollector;
export function normalizeRepository(repo: unknown, extra: RepoExtra): ExternalResource;
```

- [ ] **Step 1: 실패하는 암호화 테스트 작성**

`packages/shared/src/crypto.test.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, loadEncryptionKey } from './crypto';

const key = randomBytes(32);

describe('loadEncryptionKey', () => {
  it('base64 32바이트를 받아들인다', () => {
    expect(loadEncryptionKey(key.toString('base64')).length).toBe(32);
  });

  it('값이 없으면 변수명을 포함해 실패한다', () => {
    expect(() => loadEncryptionKey(undefined)).toThrow(/ENCRYPTION_KEY/);
  });

  it('길이가 32바이트가 아니면 실패한다', () => {
    expect(() => loadEncryptionKey(randomBytes(16).toString('base64'))).toThrow(/32/);
  });
});

describe('encrypt / decrypt', () => {
  it('왕복이 원문을 보존한다', () => {
    const secret = 'ghp_exampleToken1234567890';
    expect(decrypt(encrypt(secret, key), key)).toBe(secret);
  });

  it('같은 평문도 매번 다른 암호문이 된다', () => {
    expect(encrypt('same', key)).not.toBe(encrypt('same', key));
  });

  it('암호문에 평문이 남지 않는다', () => {
    const secret = 'ghp_exampleToken1234567890';
    expect(encrypt(secret, key)).not.toContain(secret);
  });

  it('다른 키로는 복호화되지 않는다', () => {
    expect(() => decrypt(encrypt('x', key), randomBytes(32))).toThrow();
  });

  it('본문이 변조되면 실패한다', () => {
    const [iv, tag, data] = encrypt('x', key).split('.');
    const tampered = Buffer.from(data!, 'base64');
    tampered[0] = tampered[0]! ^ 0xff;
    expect(() => decrypt(`${iv}.${tag}.${tampered.toString('base64')}`, key)).toThrow();
  });

  it('인증 태그가 변조되면 실패한다', () => {
    const [iv, tag, data] = encrypt('x', key).split('.');
    const t = Buffer.from(tag!, 'base64');
    t[0] = t[0]! ^ 0xff;
    expect(() => decrypt(`${iv}.${t.toString('base64')}.${data}`, key)).toThrow();
  });

  it('형식이 어긋나면 실패한다', () => {
    expect(() => decrypt('notavalidpayload', key)).toThrow();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm vitest run packages/shared`
Expected: FAIL — `Cannot find module './crypto'`

- [ ] **Step 3: 암호화 구현**

`packages/shared/src/crypto.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export function loadEncryptionKey(raw: string | undefined): Buffer {
  if (raw === undefined || raw.trim() === '') {
    throw new Error('환경변수 ENCRYPTION_KEY가 설정되지 않았습니다.');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY는 base64로 인코딩된 32바이트여야 합니다. 현재 ${key.length}바이트입니다.`,
    );
  }
  return key;
}

export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

export function decrypt(payload: string, key: Buffer): string {
  const parts = payload.split('.');
  if (parts.length !== 3) throw new Error('암호문 형식이 올바르지 않습니다.');
  const [ivB64, tagB64, dataB64] = parts as [string, string, string];
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
```

`packages/shared/src/index.ts`에 재export를 추가하고, `env.ts`의 `Env`에 `ENCRYPTION_KEY: string`을 필수로 더한다. 기존 env 테스트도 새 필수 변수를 포함하도록 함께 고친다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run packages/shared`
Expected: PASS — 암호화 11건 + 기존 env 테스트

- [ ] **Step 5: collectors 패키지 생성**

순서를 지킨다 — `package.json` → `tsconfig.json` → 설치.

`packages/collectors/package.json`:

```json
{
  "name": "@deployhub/collectors",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": { "typecheck": "tsc --noEmit" }
}
```

`packages/collectors/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true },
  "include": ["src", "test"]
}
```

```bash
pnpm --filter @deployhub/collectors add @octokit/rest
pnpm --filter @deployhub/collectors add '@deployhub/shared@workspace:*'
```

- [ ] **Step 6: 픽스처와 실패하는 정규화 테스트 작성**

`packages/collectors/test/fixtures/repo.json` — GitHub `GET /user/repos` 응답 한 건을 축약해 저장한다. 실제 필드명을 지킨다: `id`, `name`, `full_name`, `private`, `html_url`, `description`, `default_branch`, `topics`, `archived`, `pushed_at`, `language`.

`packages/collectors/src/github/normalize.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import repo from '../../test/fixtures/repo.json';
import { normalizeRepository } from './normalize';

const extra = {
  languages: { TypeScript: 12345, CSS: 678 },
  lastCommit: { sha: 'a41d82c', message: 'fix: 배포 스크립트', committedAt: '2026-07-20T10:00:00Z' },
  lastWorkflowRun: { name: 'CI', conclusion: 'success', runAt: '2026-07-20T10:05:00Z' },
};

describe('normalizeRepository', () => {
  it('공통 필드를 정규화한다', () => {
    const r = normalizeRepository(repo, extra);
    expect(r.provider).toBe('github');
    expect(r.resourceType).toBe('github_repository');
    expect(r.externalId).toBe(repo.full_name);
    expect(r.name).toBe(repo.name);
    expect(r.url).toBe(repo.html_url);
  });

  it('archived 저장소의 status 를 archived 로 표시한다', () => {
    expect(normalizeRepository({ ...repo, archived: true }, extra).status).toBe('archived');
    expect(normalizeRepository({ ...repo, archived: false }, extra).status).toBe('active');
  });

  it('커밋과 워크플로 결과를 metadata 에 담는다', () => {
    const m = normalizeRepository(repo, extra).metadata;
    expect(m.lastCommit).toMatchObject({ sha: 'a41d82c' });
    expect(m.lastWorkflowRun).toMatchObject({ conclusion: 'success' });
    expect(m.defaultBranch).toBe(repo.default_branch);
  });

  it('observedAt 이 ISO 8601 문자열이다', () => {
    expect(() => new Date(normalizeRepository(repo, extra).observedAt).toISOString()).not.toThrow();
  });

  it('토큰이나 비밀값을 metadata 에 넣지 않는다', () => {
    const json = JSON.stringify(normalizeRepository(repo, extra));
    expect(json).not.toMatch(/ghp_|github_pat_|Authorization/i);
  });

  it('워크플로 이력이 없어도 실패하지 않는다', () => {
    const r = normalizeRepository(repo, { ...extra, lastWorkflowRun: undefined });
    expect(r.metadata.lastWorkflowRun).toBeUndefined();
  });
});
```

마지막에서 두 번째 테스트가 구축방안 R4를 코드로 고정한다.

- [ ] **Step 7: 테스트가 실패하는지 확인**

Run: `pnpm vitest run packages/collectors`
Expected: FAIL — `Cannot find module './normalize'`

- [ ] **Step 8: 정규화와 Collector 구현**

`normalize.ts`는 순수 함수로 만든다. 네트워크를 타지 않으므로 테스트가 빠르고 결정적이다.

`github/index.ts`의 `createGithubCollector(token)`:
- `testConnection()` — `GET /user`로 로그인명을 확인한다. 실패 시 `{ ok: false, error }`를 돌려주고 **토큰을 오류 메시지에 넣지 않는다**
- `listResources()` — `octokit.paginate`로 저장소 전체를 가져오고, 각 저장소마다 languages·최근 커밋·최근 workflow run을 조회해 `normalizeRepository`로 정규화한다

`GET /user/repos`의 `affiliation`은 `owner,collaborator,organization_member`로 둔다.

- [ ] **Step 9: 테스트 통과 확인**

Run: `pnpm vitest run packages/collectors`
Expected: PASS — 6 tests

- [ ] **Step 10: worker 핸들러와 Provider 화면**

```bash
pnpm --filter worker add '@deployhub/collectors@workspace:*'
```

`apps/worker/src/handlers/github-sync.ts` — `provider_accounts`에서 계정을 읽어 토큰을 복호화하고, `listResources()` 결과를 `resources`에 upsert한다.

upsert 규칙:
- `(provider, external_id)` 충돌 시 `name`·`status`·`url`·`metadata`·`last_seen_at`을 갱신한다
- 이번 동기화에서 보이지 않은 기존 자원은 `deleted_at`을 채운다. **행을 지우지 않는다** — 구축방안 7.2의 관측 이력이다
- `last_sync_at`과 `last_error`를 `provider_accounts`에 기록한다

`apps/worker/src/index.ts`의 핸들러 레지스트리에 `'github.sync'`를 등록하고, 시작 시 6시간 주기로 `enqueue`한다.

`apps/web/src/app/providers/page.tsx` — 토큰 입력·연결 테스트·수동 동기화. **입력한 토큰을 화면에 되비추지 마라.** 저장 후에는 `last_verified_at`과 마지막 4자리만 표시한다.

- [ ] **Step 11: 전체 검증**

Run: `pnpm typecheck && pnpm vitest run && pnpm --filter web build && pnpm --filter worker build`
Expected: 전부 통과

Run: `git grep -nE 'ghp_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{16,}' -- apps packages ':!*.test.ts'`
Expected: 매치 없음

**검사 범위를 `apps`·`packages`로 한정하는 이유:** 저장소 전체를 훑으면 이 계획서 자체가 매치된다. 문서에는 예제 토큰과 이 grep 명령문이 정당하게 들어 있다. 검사의 목적은 *소스 코드에 실제 토큰이 커밋되지 않았는가*이지 *문서에 그 문자열이 없는가*가 아니다. 접두사 뒤 16자 이상을 요구하는 것도 같은 이유로, 산문에 등장하는 접두사만으로는 매치되지 않게 한다.

**문서를 고쳐서 이 검사를 통과시키지 마라.** 검사가 오탐하면 검사를 고치는 것이 맞다.

- [ ] **Step 12: 커밋**

```bash
git add -A && git commit -m "feat: 토큰 암호화와 GitHub Collector"
```

**게이트 통과 조건:** 암호화 11건·정규화 6건 통과. 변조 감지 2건이 반드시 통과할 것. 토큰이 로그·오류 메시지·`metadata` 어디에도 남지 않을 것. `.env.example`에 `ENCRYPTION_KEY`가 이름만 추가될 것.

---

## Task 5: 저장소 기준 그룹핑과 자원 화면

**Files:**
- Create: `packages/db/src/queries/resources.ts`, `packages/db/src/queries/resources.test.ts`
- Create: `apps/web/src/lib/matcher.ts`, `apps/web/src/lib/matcher.test.ts`
- Create: `apps/web/src/actions/links.ts`
- Create: `apps/web/src/app/resources/page.tsx`
- Modify: `apps/web/src/app/projects/[slug]/page.tsx`, `apps/web/src/app/page.tsx`

**Interfaces:**
- Consumes: Task 2의 `projects.repository`, Task 4가 채운 `resources`
- Produces:

```ts
export type MatchSuggestion = {
  resourceId: string;
  externalId: string;      // "owner/name"
  projectId: string;
  projectSlug: string;
  basis: 'repository' | 'name';
};

export function suggestMatches(
  repos: { id: string; externalId: string; name: string }[],
  projects: { id: string; slug: string; repository: string | null }[],
): MatchSuggestion[];

export async function listUnlinkedResources(db: Db): Promise<ResourceRow[]>;
```

- [ ] **Step 1: 실패하는 매처 테스트 작성**

`apps/web/src/lib/matcher.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { suggestMatches } from './matcher';

const repos = [
  { id: 'r1', externalId: 'ktgo/workwiki', name: 'workwiki' },
  { id: 'r2', externalId: 'ktgo/linkvault', name: 'linkvault' },
  { id: 'r3', externalId: 'ktgo/etflow', name: 'etflow' },
];

describe('suggestMatches', () => {
  it('repository 값이 정확히 일치하면 repository 근거로 제안한다', () => {
    const out = suggestMatches(repos, [{ id: 'p1', slug: 'workwiki', repository: 'ktgo/workwiki' }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ resourceId: 'r1', projectId: 'p1', basis: 'repository' });
  });

  it('repository 가 비었으면 저장소 이름과 slug 일치를 name 근거로 제안한다', () => {
    const out = suggestMatches(repos, [{ id: 'p2', slug: 'linkvault', repository: null }]);
    expect(out[0]).toMatchObject({ resourceId: 'r2', projectId: 'p2', basis: 'name' });
  });

  it('repository 가 있으면 이름 일치보다 우선한다', () => {
    const out = suggestMatches(repos, [{ id: 'p3', slug: 'workwiki', repository: 'ktgo/etflow' }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ resourceId: 'r3', basis: 'repository' });
  });

  it('대소문자를 구분하지 않는다', () => {
    const out = suggestMatches(repos, [{ id: 'p4', slug: 'x', repository: 'KTGO/WorkWiki' }]);
    expect(out[0]?.resourceId).toBe('r1');
  });

  it('부분 일치를 제안하지 않는다', () => {
    expect(suggestMatches(repos, [{ id: 'p5', slug: 'work', repository: null }])).toHaveLength(0);
    expect(suggestMatches(repos, [{ id: 'p6', slug: 'x', repository: 'ktgo/work' }])).toHaveLength(0);
  });

  it('한 저장소를 여러 프로젝트에 중복 제안하지 않는다', () => {
    const out = suggestMatches(repos, [
      { id: 'p7', slug: 'a', repository: 'ktgo/workwiki' },
      { id: 'p8', slug: 'b', repository: 'ktgo/workwiki' },
    ]);
    expect(out.filter((m) => m.resourceId === 'r1')).toHaveLength(1);
  });

  it('일치가 없으면 빈 배열을 돌려준다', () => {
    expect(suggestMatches(repos, [{ id: 'p9', slug: 'nope', repository: null }])).toEqual([]);
  });
});
```

마지막에서 세 번째 테스트가 구축방안 14.2("자동 이름 매칭만으로 즉시 연결하지 않는다")의 근거다 — 부분 일치는 제안조차 하지 않는다.

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `pnpm vitest run apps/web/src/lib`
Expected: FAIL — `Cannot find module './matcher'`

- [ ] **Step 3: 매처 구현**

`repository` 정확 일치를 먼저 처리하고, 남은 저장소에 한해 이름·slug 정확 일치를 본다. 정규화는 소문자 변환만 한다. 유사도·부분 문자열을 쓰지 마라.

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run apps/web/src/lib`
Expected: PASS — 7 tests

- [ ] **Step 5: 연결 Action 구현**

`apps/web/src/actions/links.ts` — 제안을 사람이 확인해야 실제 연결이 된다.

**`relation_type`은 `'uses'`를 쓴다.** enum 6종 중 "이 구성요소의 소스가 여기 있다"에 가장 가까운 값이다. 딱 맞지는 않으므로 나중에 전용 값을 더할 수 있으나 지금 enum을 바꾸지 않는다.

**제안은 저장하지 않고 화면 진입 시 계산한다.** `linked_by = 'suggested'`로 미리 저장하지 않는다.

이유는 `component_resources`가 `component_id`를 필수로 요구하기 때문이다. 어느 구성요소에 붙일지는 사람만 정할 수 있으므로, 사람이 구성요소를 고르는 순간 이미 확인이 있었던 것이다. 그 뒤에 `suggested`로 저장했다가 별도 목록에서 또 확인받으면 같은 사람에게 확인을 두 번 받는 셈이고, 두 번째는 의미 없는 클릭이 된다.

저장되는 것은 확정된 연결뿐이다.

| 경로 | 저장되는 `linked_by` |
|---|---|
| `repository` 정확 일치를 사용자가 구성요소를 골라 확인 | `'repository'` |
| 이름 일치를 사용자가 구성요소를 골라 확인 | `'user'` |
| 무시 | 아무것도 저장하지 않음 |

**`'suggested'` 값은 남겨두되 M1b에서 쓰지 않는다.** 이 값은 사람 개입 없이 기계가 후보를 기록할 수 있을 때를 위한 것이다. M3의 Docker Label 매칭은 라벨에 `deployhub.component`가 있어 기계가 구성요소까지 특정할 수 있으므로, 그때 자동 제안 행을 `'suggested'`로 남기고 사람이 `'user'`로 승격하는 흐름이 성립한다.

**알려진 한계:** 무시한 후보는 다음 조회에서 다시 나타난다. 저장소 20개 규모에서는 감수한다. "관리 제외" 상태를 두려면 스키마 변경이 필요하므로 지금 만들지 않는다.

연결 대상 컴포넌트가 없으면 프로젝트의 기본 컴포넌트를 만들지 말고, 화면에서 어느 구성요소에 붙일지 고르게 한다.

- [ ] **Step 6: 화면 구현**

`resources/page.tsx` — 세 영역:
1. **수집된 저장소** — 이름 · 마지막 커밋(SHA·시각) · 워크플로 결과 · 연결된 프로젝트
2. **연결 제안** — 근거(`repository`/`name`)와 함께, 확인·무시 버튼
3. **미연결 자원** — 어떤 프로젝트에도 붙지 않은 것. 구축방안 16.6대로 `Unlinked` 표시

프로젝트 상세에 "연결된 자원" 섹션을 더하고, Overview에 요약 카드(전체 프로젝트 · 수집 저장소 · 미연결 · 최근 커밋 24시간)를 넣는다.

- [ ] **Step 7: 전체 검증**

Run: `pnpm typecheck && pnpm vitest run && pnpm --filter web build && pnpm --filter worker build`
Expected: 전부 통과

- [ ] **Step 8: 커밋**

```bash
git add -A && git commit -m "feat: 저장소 기준 그룹핑과 자원 화면"
```

**게이트 통과 조건:** 매처 7건 통과. 부분 일치를 제안하지 않을 것. `name` 근거 제안이 `suggested`로만 저장되고 자동 연결되지 않을 것.

---

## Self-Review

**1. 구축방안 M1 커버리지**

| 구축방안 M1 항목 | Task |
|---|---|
| Raycast 토큰 → Tailwind, Sidebar 240px | 1 |
| 프로젝트·구성요소 CRUD, 목록, 상세 | 2, 3 |
| GitHub Collector (저장소·브랜치·언어·토픽·커밋·워크플로) | 4 |
| 저장소 기준 자동 그룹핑 → 확인 UI | 5 |
| `provider_accounts` 토큰 암호화 | 4 |

M1a에서 이미 끝난 항목(워크스페이스·스키마·인증·큐·컨테이너)은 다시 다루지 않는다.

**2. 타입 일관성**

- `Db` — M1a `packages/db`에서 정의, Task 2·4·5가 소비 ✓
- `ExternalResource` — Task 4에서 정의, Task 5의 `resources` 조회가 소비 ✓
- `COMPONENT_TYPES` 11종 — Task 3에서 정의하되 M1a의 `componentType` pgEnum과 일치해야 함을 명시 ✓
- `projects.repository` — Task 2에서 추가, Task 5 매처가 소비 ✓
- `MatchSuggestion.basis` — `'repository' | 'name'`. `component_resources.linked_by`의 `'repository' | 'suggested' | 'user'`와 다른 개념임을 Task 5 Step 5에서 매핑 ✓

**3. 위험 지점**

- **Task 4의 토큰 유출.** 로그·오류 메시지·`metadata`·화면 되비추기 네 경로를 각각 막았고, `git grep`으로 커밋 전 확인한다.
- **Task 5의 자동 연결.** 이름 근거 제안이 실수로 즉시 연결되면 구축방안 14.2를 어긴다. `linked_by` 값으로 구분하고 테스트로 고정한다.
- **Task 2의 마이그레이션.** `repository`를 unique로 만들면 모노레포를 여러 프로젝트로 나눌 수 없다. 명시적으로 금지했다.
- **테스트 수 예상치.** Task 2 Step 12에 예상 수치를 적었으나 실제와 다를 수 있다. 실행 결과를 따르라고 명시했다 — M1a Task 5에서 내 산수 오류로 한 사이클을 소모했다.

**4. M1a에서 배운 것의 반영**

- 설치 순서: 새 패키지는 `package.json` → `tsconfig.json` → 설치 (Global Constraints)
- `workspace:*` 명시 (Global Constraints, Task 4 Step 5·10)
- 확장자 없는 import (Global Constraints)
- `rootDir`/`outDir` 없는 tsconfig (Global Constraints)
- 버전 불확실성 제거: Tailwind 4.3.3 · Zod 4.4.3 · Octokit 22.0.1을 계획 작성 시점에 실제 확인했다

---

## Execution

orca orchestration + codex 위임. Task 1 → 2 → 3 → 4 → 5 순서로 진행한다.

Task 2가 3·5의 선행이고 Task 4가 5의 선행이므로 병렬화하지 않는다. 각 Task는 격리 worktree에서 수행하고, 검증 명령 통과 후 코디네이터 검토를 거쳐 main에 병합한다.

디스패치 후 프롬프트가 실제 제출됐는지 터미널을 확인하고, 질문에는 중복본까지 답한 뒤 미읽음 0을 확인하고 대기로 넘어간다.
