# 프로젝트 목록 표시 순서 변경 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트 목록에서 카드 헤더의 드래그 핸들로 표시 순서를 바꾸고, 그 순서를 서버에 저장한다.

**Architecture:** `projects` 테이블에 `display_order` integer 컬럼을 추가한다. 목록 화면 전용 정렬 함수가 이 컬럼으로 정렬하고, 드롭할 때마다 서버 액션이 목록 전체를 `0..n-1`로 다시 부여한다. 드래그는 외부 라이브러리 없이 Pointer Events로 구현하며, 재배치 계산은 순수 함수로 분리한다.

**Tech Stack:** TypeScript 6.0.3, Next.js 16 App Router (서버 액션), React 19, Drizzle ORM 0.45.2, drizzle-kit 0.31.10, PostgreSQL 17, Vitest 4.1.10, Testcontainers PostgreSQL

**설계 문서:** `docs/superpowers/specs/2026-08-05-project-display-order-design.md`

## Global Constraints

- 새 npm 의존성을 추가하지 않는다. 드래그는 Pointer Events로 직접 구현한다.
- `apps/web/src/app/page.tsx`는 서버 컴포넌트로 남는다. `'use client'`를 넣으면 `apps/web/src/components/schematic/project-sheet.test.ts:69`가 실패한다.
- `listProjects`(이름 오름차순)는 그대로 둔다. `/events`와 `/settings/resources`의 프로젝트 선택 드롭다운이 이 순서에 의존한다.
- `packages/db` 통합 테스트는 Testcontainers를 쓰므로 Docker 데몬이 실행 중이어야 한다.
- 테스트 이름과 UI 문구는 한국어로 쓴다. 저장소의 기존 관행이다.
- 커밋 메시지는 `feat:`, `fix:`, `docs:`, `test:` 접두사를 쓴다.
- 전체 검증은 `pnpm typecheck`와 `pnpm test`다. 개별 파일은 `pnpm vitest run <경로>`로 돌린다.

---

### Task 1: `display_order` 컬럼과 마이그레이션 백필

**Files:**
- Modify: `packages/db/src/schema/projects.ts:32-33`
- Create: `drizzle/0011_project_display_order.sql` (drizzle-kit이 생성 후 손으로 백필 추가)
- Modify: `drizzle/meta/_journal.json` (drizzle-kit이 자동 갱신)
- Create: `drizzle/meta/0011_snapshot.json` (drizzle-kit이 자동 생성)
- Test: `packages/db/src/schema/migrations.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `schema.projects.displayOrder` (`integer`, `NOT NULL`, `DEFAULT 0`)

- [ ] **Step 1: 마이그레이션 테스트를 먼저 쓴다**

`packages/db/src/schema/migrations.test.ts` 맨 위 URL 상수들 아래에 추가한다.

```ts
const projectDisplayOrderMigrationUrl = new URL(
  '../../../../drizzle/0011_project_display_order.sql',
  import.meta.url,
);
```

파일 맨 아래에 describe 블록을 추가한다.

```ts
describe('project display order migration', () => {
  it('adds the column and backfills existing rows in name order', async () => {
    const migration = await readFile(projectDisplayOrderMigrationUrl, 'utf8');

    expect(migration).toContain(
      'ALTER TABLE "projects" ADD COLUMN "display_order" integer DEFAULT 0 NOT NULL;',
    );
    expect(migration).toContain('row_number() OVER (ORDER BY name) - 1');
    expect(migration).toContain(
      'UPDATE projects SET display_order = ordered.position',
    );
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm vitest run packages/db/src/schema/migrations.test.ts`
Expected: FAIL — `ENOENT: no such file or directory ... 0011_project_display_order.sql`

- [ ] **Step 3: 스키마에 컬럼을 더한다**

`packages/db/src/schema/projects.ts`의 `projects` 테이블에서 `snapshotMode` 줄 바로 아래에 넣는다. `integer`는 이미 import 되어 있다.

```ts
    snapshotMode: snapshotMode('snapshot_mode').notNull().default('disabled'),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
```

인덱스는 만들지 않는다. 행이 수십 개 규모라 순차 스캔이 더 빠르고, 정렬 키가 재정렬마다 통째로 다시 쓰이므로 인덱스는 유지 비용만 남는다.

- [ ] **Step 4: 마이그레이션을 생성한다**

```bash
cd packages/db && pnpm exec drizzle-kit generate --name project_display_order
```

`drizzle/0011_project_display_order.sql`, `drizzle/meta/0011_snapshot.json`이 생기고 `drizzle/meta/_journal.json`에 `idx: 11` 항목이 추가된다. 생성된 SQL이 아래 한 줄뿐인지 확인한다. 다른 문장이 섞여 있으면 이전 작업의 스키마 변경이 누락된 것이므로 멈추고 보고한다.

```sql
ALTER TABLE "projects" ADD COLUMN "display_order" integer DEFAULT 0 NOT NULL;
```

- [ ] **Step 5: 백필 문장을 손으로 덧붙인다**

`drizzle/0011_project_display_order.sql` 끝에 이어 쓴다. `0008_component_health_url.sql`, `0009_project_snapshots.sql`처럼 손으로 이름 붙인 선례가 있다.

```sql
--> statement-breakpoint
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY name) - 1 AS position FROM projects
)
UPDATE projects SET display_order = ordered.position
FROM ordered WHERE projects.id = ordered.id;
```

이 백필 덕분에 배포 직후 목록이 지금과 똑같은 이름 오름차순으로 보인다. 아카이브된 프로젝트에도 값이 들어가지만 목록이 `archivedAt`으로 거르므로 화면에는 영향이 없다.

- [ ] **Step 6: 테스트가 통과하는지 확인한다**

Run: `pnpm vitest run packages/db/src/schema/migrations.test.ts`
Expected: PASS

- [ ] **Step 7: 마이그레이션이 실제로 적용되는지 확인한다**

Run: `pnpm vitest run packages/db/src/queries/projects.test.ts`
Expected: PASS. 이 테스트는 Testcontainers로 빈 PostgreSQL을 띄우고 `drizzle` 폴더의 마이그레이션을 전부 적용하므로, SQL 문법 오류가 있으면 여기서 드러난다.

- [ ] **Step 8: 커밋**

```bash
git add packages/db/src/schema/projects.ts packages/db/src/schema/migrations.test.ts drizzle/
git commit -m "feat(db): add project display order column"
```

---

### Task 2: 표시 순서 조회와 새 프로젝트 순서 값

**Files:**
- Modify: `packages/db/src/client.ts`
- Modify: `packages/db/src/index.ts:2`
- Modify: `packages/db/src/queries/projects.ts:49-56`
- Test: `packages/db/src/queries/projects.test.ts`

**Interfaces:**
- Consumes: `schema.projects.displayOrder` (Task 1)
- Produces:
  - `type DbExecutor = Db | <트랜잭션 핸들>` — `packages/db/src/client.ts`에서 export
  - `listProjectsInDisplayOrder(db: Db): Promise<ProjectRow[]>`
  - `nextTopDisplayOrder(db: DbExecutor): Promise<number>`
  - `listProjectsWithSummaryData`는 이제 표시 순서를 따른다

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/db/src/queries/projects.test.ts`의 import 문에 두 함수를 더한다.

```ts
import {
  getProjectBySlug,
  listProjects,
  listProjectsInDisplayOrder,
  listProjectsWithSummaryData,
  nextTopDisplayOrder,
} from './projects';
```

`describe('프로젝트 조회', ...)` 안에 테스트 세 개를 추가한다.

```ts
  it('표시 순서 오름차순으로 목록을 돌려주고 같은 값은 이름으로 가른다', async () => {
    await db.insert(schema.projects).values([
      { name: 'C', slug: 'c', displayOrder: 0 },
      { name: 'A', slug: 'a', displayOrder: 2 },
      { name: 'B', slug: 'b', displayOrder: 0 },
      { name: 'D', slug: 'd', displayOrder: 1, archivedAt: new Date() },
    ]);

    const rows = await listProjectsInDisplayOrder(db);

    expect(rows.map((r) => r.slug)).toEqual(['b', 'c', 'a']);
  });

  it('요약 목록도 이름순이 아니라 표시 순서를 따른다', async () => {
    await db.insert(schema.projects).values([
      { name: 'A', slug: 'a', displayOrder: 1 },
      { name: 'B', slug: 'b', displayOrder: 0 },
    ]);

    const rows = await listProjectsWithSummaryData(db);

    expect(rows.map((r) => r.slug)).toEqual(['b', 'a']);
  });

  it('새 프로젝트 순서 값은 아카이브 포함 현재 최솟값보다 작다', async () => {
    expect(await nextTopDisplayOrder(db)).toBe(-1);

    await db.insert(schema.projects).values([
      { name: 'A', slug: 'a', displayOrder: 3 },
      { name: 'B', slug: 'b', displayOrder: 5, archivedAt: new Date() },
      { name: 'C', slug: 'c', displayOrder: 1 },
    ]);

    expect(await nextTopDisplayOrder(db)).toBe(0);
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm vitest run packages/db/src/queries/projects.test.ts`
Expected: FAIL — `listProjectsInDisplayOrder is not a function` 또는 import 해석 실패

- [ ] **Step 3: 트랜잭션도 받는 실행자 타입을 정의한다**

`packages/db/src/client.ts` 끝에 추가한다.

```ts
/**
 * 트랜잭션 안팎 어디서나 쓸 수 있는 질의 실행자.
 * drizzle 이 트랜잭션 핸들 타입을 따로 export 하지 않으므로
 * `transaction` 콜백의 첫 인자 타입에서 끌어온다.
 */
export type DbExecutor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];
```

`packages/db/src/index.ts`의 타입 export 줄을 바꾼다.

```ts
export type { Db, DbExecutor } from './client';
```

- [ ] **Step 4: 조회 함수 두 개를 구현한다**

`packages/db/src/queries/projects.ts`의 import에 `DbExecutor`를 더한다.

```ts
import type { Db, DbExecutor } from '../client';
```

기존 `listProjects` 바로 아래에 추가한다.

```ts
/**
 * 목록 화면 전용 정렬. `listProjects` 는 드롭다운이 쓰는 이름순이므로
 * 건드리지 않는다. 이름 타이브레이크는 백필 이전 행이나 동시 삽입으로
 * 값이 겹칠 때 순서가 요동치지 않게 한다.
 */
export async function listProjectsInDisplayOrder(db: Db): Promise<ProjectRow[]> {
  return db
    .select()
    .from(projects)
    .where(isNull(projects.archivedAt))
    .orderBy(asc(projects.displayOrder), asc(projects.name));
}

/**
 * 새 프로젝트를 목록 맨 위에 놓을 순서 값.
 * 아카이브된 행까지 포함해 최솟값을 잡아야 복구된 프로젝트와 값이 겹치지 않는다.
 */
export async function nextTopDisplayOrder(db: DbExecutor): Promise<number> {
  const [row] = await db
    .select({
      next: sql<number>`coalesce(min(${projects.displayOrder}), 0) - 1`,
    })
    .from(projects);
  return row?.next ?? -1;
}
```

`listProjectsWithSummaryData` 첫 줄을 바꾼다.

```ts
  const projectRows = await listProjectsInDisplayOrder(db);
```

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run: `pnpm vitest run packages/db/src/queries/projects.test.ts`
Expected: PASS. 같은 파일의 질의 횟수 테스트도 계속 통과해야 한다. 프로젝트 조회 질의 개수는 그대로 하나다.

- [ ] **Step 6: 타입 검사**

Run: `pnpm typecheck`
Expected: 오류 없음

- [ ] **Step 7: 커밋**

```bash
git add packages/db/src/client.ts packages/db/src/index.ts packages/db/src/queries/projects.ts packages/db/src/queries/projects.test.ts
git commit -m "feat(db): sort the project list by display order"
```

---

### Task 3: `reorderProjects` 서버 액션

**Files:**
- Modify: `apps/web/src/actions/projects.ts`
- Test: `apps/web/src/actions/projects.test.ts`

**Interfaces:**
- Consumes: `schema.projects.displayOrder` (Task 1)
- Produces: `reorderProjects(orderedIds: string[]): Promise<{ status: 'success' | 'stale' | 'error' }>`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

현재 `apps/web/src/actions/projects.test.ts`는 `db`를 빈 객체로 mock 하고 인증 거부만 검증한다. 실제 DB 동작을 검증해야 하므로 `drafts.test.ts:19-38`의 프록시 패턴으로 교체한다. 파일 전체를 아래로 바꾼다.

```ts
import { asc } from 'drizzle-orm';
import { schema, type Db } from '@deployhub/db';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { startTestDb } from '../../../../packages/db/test/helpers/pg';

const { authMock, dbProxy, dbState } = vi.hoisted(() => {
  const state: { current?: Record<PropertyKey, unknown> } = {};
  return {
    authMock: vi.fn(),
    dbState: state,
    dbProxy: new Proxy({}, {
      get(_target, property) {
        const database = state.current;
        if (!database) throw new Error('test database is not ready');
        const value = database[property];
        return typeof value === 'function' ? value.bind(database) : value;
      },
    }),
  };
});

vi.mock('../auth/config', () => ({ auth: authMock }));
vi.mock('../lib/db', () => ({ db: dbProxy }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import {
  archiveProject,
  createProject,
  reorderProjects,
  updateProject,
} from './projects';

const emptyState = { status: 'idle' as const };

let db: Db;
let stop: () => Promise<void>;

beforeAll(async () => {
  const started = await startTestDb();
  db = started.db;
  stop = started.stop;
  dbState.current = db as unknown as Record<PropertyKey, unknown>;
}, 120_000);

afterAll(async () => {
  await stop();
});

beforeEach(async () => {
  await db.delete(schema.projects);
  authMock.mockReset();
  authMock.mockResolvedValue(null);
});

async function seedProjects(): Promise<string[]> {
  const rows = await db
    .insert(schema.projects)
    .values([
      { name: 'A', slug: 'a', displayOrder: 0 },
      { name: 'B', slug: 'b', displayOrder: 1 },
      { name: 'C', slug: 'c', displayOrder: 2 },
    ])
    .returning({ id: schema.projects.id, slug: schema.projects.slug });
  return ['a', 'b', 'c'].map((slug) => {
    const row = rows.find((candidate) => candidate.slug === slug);
    if (!row) throw new Error(`seed 실패: ${slug}`);
    return row.id;
  });
}

async function currentOrder(): Promise<string[]> {
  const rows = await db
    .select({ slug: schema.projects.slug })
    .from(schema.projects)
    .orderBy(asc(schema.projects.displayOrder), asc(schema.projects.name));
  return rows.map((row) => row.slug);
}

describe('프로젝트 Server Actions 인증', () => {
  it('createProject 는 세션이 없으면 즉시 거부한다', async () => {
    await expect(createProject(emptyState, new FormData())).rejects.toThrow(/인증/);
  });

  it('updateProject 는 세션이 없으면 즉시 거부한다', async () => {
    await expect(updateProject('project-id', emptyState, new FormData())).rejects.toThrow(/인증/);
  });

  it('archiveProject 는 세션이 없으면 즉시 거부한다', async () => {
    await expect(archiveProject('project-id')).rejects.toThrow(/인증/);
  });

  it('reorderProjects 는 세션이 없으면 즉시 거부한다', async () => {
    await expect(reorderProjects([])).rejects.toThrow(/인증/);
  });
});

describe('reorderProjects', () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ user: { name: 'tester' } });
  });

  it('받은 순서대로 0 부터 다시 부여한다', async () => {
    const [a, b, c] = await seedProjects();

    await expect(reorderProjects([c!, a!, b!])).resolves.toEqual({ status: 'success' });
    await expect(currentOrder()).resolves.toEqual(['c', 'a', 'b']);
  });

  it('빠진 프로젝트가 있으면 stale 을 돌려주고 아무 행도 바꾸지 않는다', async () => {
    const [a, b] = await seedProjects();

    await expect(reorderProjects([b!, a!])).resolves.toEqual({ status: 'stale' });
    await expect(currentOrder()).resolves.toEqual(['a', 'b', 'c']);
  });

  it('목록에 없는 id 가 섞이면 stale 을 돌려준다', async () => {
    const [a, b] = await seedProjects();
    const unknown = '00000000-0000-4000-8000-000000000000';

    await expect(reorderProjects([a!, b!, unknown])).resolves.toEqual({ status: 'stale' });
    await expect(currentOrder()).resolves.toEqual(['a', 'b', 'c']);
  });

  it('같은 id 가 중복되면 error 를 돌려준다', async () => {
    const [a, b] = await seedProjects();

    await expect(reorderProjects([a!, b!, a!])).resolves.toEqual({ status: 'error' });
    await expect(currentOrder()).resolves.toEqual(['a', 'b', 'c']);
  });

  it('아카이브된 프로젝트는 순서 대상에서 빠진다', async () => {
    const [a, b, c] = await seedProjects();
    await db
      .update(schema.projects)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projects.id, c!));

    await expect(reorderProjects([b!, a!])).resolves.toEqual({ status: 'success' });
  });
});
```

마지막 테스트가 쓰는 `eq`를 첫 import 줄에 더한다.

```ts
import { asc, eq } from 'drizzle-orm';
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm vitest run apps/web/src/actions/projects.test.ts`
Expected: FAIL — `reorderProjects` export 없음

- [ ] **Step 3: 액션을 구현한다**

`apps/web/src/actions/projects.ts`의 import를 넓힌다.

```ts
import { eq, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { schema } from '@deployhub/db';
```

파일 끝에 추가한다.

```ts
export type ReorderProjectsResult = {
  status: 'success' | 'stale' | 'error';
};

const orderedIdsSchema = z.array(z.uuid()).min(1);

/**
 * 목록 전체 순서를 0..n-1 로 다시 부여한다.
 *
 * 쓰기 전에 아카이브되지 않은 프로젝트 id 집합이 요청과 정확히 같은지
 * 검사한다. 이게 없으면 다른 탭에서 Draft 를 승인한 뒤 낡은 배열로 저장할 때
 * 새 프로젝트가 순서에서 탈락한다.
 *
 * `updatedAt` 은 건드리지 않는다. 순서 변경은 프로젝트 내용 변경이 아니다.
 */
export async function reorderProjects(
  orderedIds: string[],
): Promise<ReorderProjectsResult> {
  const session = await auth();
  if (!session) throw new Error('인증이 필요합니다.');

  const parsed = orderedIdsSchema.safeParse(orderedIds);
  if (!parsed.success) return { status: 'error' };
  if (new Set(parsed.data).size !== parsed.data.length) {
    return { status: 'error' };
  }

  try {
    const applied = await db.transaction(async (tx) => {
      const current = await tx
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(isNull(schema.projects.archivedAt));

      const currentIds = new Set(current.map((row) => row.id));
      if (currentIds.size !== parsed.data.length) return false;
      if (parsed.data.some((id) => !currentIds.has(id))) return false;

      const positions = sql.join(
        parsed.data.map(
          (id, position) => sql`(${id}::uuid, ${position}::integer)`,
        ),
        sql`, `,
      );
      await tx.execute(sql`
        update ${schema.projects} as p
        set display_order = v.position
        from (values ${positions}) as v(id, position)
        where p.id = v.id
      `);

      return true;
    });

    if (!applied) return { status: 'stale' };
  } catch {
    return { status: 'error' };
  }

  revalidatePath('/');
  return { status: 'success' };
}
```

`z.uuid()`는 zod 4 문법이다. 이 저장소는 zod 4.4.3을 쓴다.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `pnpm vitest run apps/web/src/actions/projects.test.ts`
Expected: PASS (6개)

- [ ] **Step 5: 타입 검사**

Run: `pnpm typecheck`
Expected: 오류 없음

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/actions/projects.ts apps/web/src/actions/projects.test.ts
git commit -m "feat(web): add a project reorder server action"
```

---

### Task 4: 새 프로젝트를 목록 맨 위에 놓기

**Files:**
- Modify: `apps/web/src/actions/drafts.ts:124-131`
- Modify: `apps/web/src/actions/projects.ts` (`createProject`)
- Test: `apps/web/src/actions/drafts.test.ts`
- Test: `apps/web/src/actions/projects.test.ts`

**Interfaces:**
- Consumes: `nextTopDisplayOrder(db: DbExecutor): Promise<number>` (Task 2)
- Produces: 없음

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/actions/drafts.test.ts`의 `describe('approveDraft', ...)` 안에 추가한다. 같은 파일의 `pendingDraft()` 헬퍼(`drafts.test.ts:147-170`)를 그대로 쓴다.

```ts
  it('승인으로 만든 프로젝트를 목록 맨 위에 놓는다', async () => {
    await db.insert(schema.projects).values({
      name: 'Existing',
      slug: 'existing',
      displayOrder: 0,
    });
    const draft = await pendingDraft();

    await approveDraft(draft.id);

    const [created] = await db
      .select({ displayOrder: schema.projects.displayOrder })
      .from(schema.projects)
      .where(eq(schema.projects.slug, 'deployhub'));

    expect(created?.displayOrder).toBe(-1);
  });
```

`apps/web/src/actions/projects.test.ts`의 `describe('reorderProjects', ...)` 아래에 새 describe를 추가한다.

```ts
describe('createProject 순서', () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ user: { name: 'tester' } });
  });

  it('수동 등록한 프로젝트도 목록 맨 위에 놓는다', async () => {
    await seedProjects();

    const form = new FormData();
    form.set('name', 'New');
    form.set('slug', 'new');
    form.set('status', 'active');
    form.set('lifecycle', 'development');
    form.set('importance', '3');

    await expect(createProject(emptyState, form)).resolves.toMatchObject({
      status: 'success',
    });

    const [created] = await db
      .select({ displayOrder: schema.projects.displayOrder })
      .from(schema.projects)
      .where(eq(schema.projects.slug, 'new'));

    expect(created?.displayOrder).toBe(-1);
  });
});
```

위 다섯 필드가 `projectInputSchema`(`apps/web/src/lib/schemas.ts:12-24`)의 필수 항목 전부다. `description`, `owner`, `repository`는 선택이다.

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm vitest run apps/web/src/actions/projects.test.ts apps/web/src/actions/drafts.test.ts`
Expected: FAIL — 두 테스트 모두 `displayOrder`가 `0`으로 나온다 (컬럼 기본값)

- [ ] **Step 3: Draft 승인 경로를 고친다**

`apps/web/src/actions/drafts.ts`의 import에 `nextTopDisplayOrder`를 더한다.

```ts
import { nextTopDisplayOrder, schema } from '@deployhub/db';
```

기존 import 형태에 맞춰 합친다. 그리고 insert 분기를 바꾼다.

```ts
    } else {
      const [created] = await tx
        .insert(schema.projects)
        .values({
          ...projectValues,
          displayOrder: await nextTopDisplayOrder(tx),
        })
        .returning({ id: schema.projects.id });
      if (!created) throw new Error('프로젝트를 만들지 못했습니다.');
      projectId = created.id;
    }
```

update 분기는 건드리지 않는다. 기존 프로젝트를 갱신하는 승인은 순서를 옮기면 안 된다.

- [ ] **Step 4: 수동 등록 경로를 고친다**

`apps/web/src/actions/projects.ts`의 `createProject`에서 insert를 트랜잭션으로 감싼다. 순서 값을 읽고 쓰는 사이에 다른 삽입이 끼지 않게 한다.

```ts
  try {
    await db.transaction(async (tx) => {
      await tx.insert(schema.projects).values({
        ...parsed.data,
        description: parsed.data.description ?? null,
        owner: parsed.data.owner ?? null,
        repository: parsed.data.repository ?? null,
        archivedAt: parsed.data.status === 'archived' ? new Date() : null,
        displayOrder: await nextTopDisplayOrder(tx),
      });
    });
  } catch (error) {
```

`catch` 블록은 그대로 둔다. 트랜잭션 안에서 던진 unique 위반이 그대로 밖으로 나오므로 `isUniqueViolation`이 계속 잡는다.

같은 파일 import에 `nextTopDisplayOrder`를 더한다.

```ts
import { nextTopDisplayOrder, schema } from '@deployhub/db';
```

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run: `pnpm vitest run apps/web/src/actions/projects.test.ts apps/web/src/actions/drafts.test.ts`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add apps/web/src/actions/drafts.ts apps/web/src/actions/drafts.test.ts apps/web/src/actions/projects.ts apps/web/src/actions/projects.test.ts
git commit -m "feat(web): place newly registered projects at the top of the list"
```

---

### Task 5: `moveItem` 순수 함수

**Files:**
- Create: `apps/web/src/lib/move-item.ts`
- Test: `apps/web/src/lib/move-item.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `moveItem(items: readonly string[], from: number, to: number): string[]`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/web/src/lib/move-item.test.ts`를 만든다.

```ts
import { describe, expect, it } from 'vitest';
import { moveItem } from './move-item';

describe('moveItem', () => {
  it('항목을 위로 옮긴다', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('항목을 아래로 옮긴다', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('제자리로 옮기면 그대로 둔다', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
  });

  it('목표 위치가 범위를 벗어나면 양 끝으로 붙인다', () => {
    expect(moveItem(['a', 'b', 'c'], 1, -5)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 1, 9)).toEqual(['a', 'c', 'b']);
  });

  it('출발 위치가 범위를 벗어나면 원본 복사본을 돌려준다', () => {
    const items = ['a', 'b', 'c'];

    const result = moveItem(items, 5, 0);

    expect(result).toEqual(items);
    expect(result).not.toBe(items);
  });

  it('원본 배열을 바꾸지 않는다', () => {
    const items = ['a', 'b', 'c'];

    moveItem(items, 0, 2);

    expect(items).toEqual(['a', 'b', 'c']);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm vitest run apps/web/src/lib/move-item.test.ts`
Expected: FAIL — `Failed to resolve import "./move-item"`

- [ ] **Step 3: 구현한다**

`apps/web/src/lib/move-item.ts`를 만든다.

```ts
/**
 * 배열에서 한 항목을 다른 위치로 옮긴 새 배열을 돌려준다.
 * 목표 위치는 배열 범위로 잘라 낸다. 드래그 중 포인터가 목록 밖으로
 * 나가도 양 끝에 붙기만 하고 항목이 사라지지 않게 하기 위해서다.
 */
export function moveItem(
  items: readonly string[],
  from: number,
  to: number,
): string[] {
  const next = [...items];
  if (from < 0 || from >= next.length) return next;

  const target = Math.max(0, Math.min(to, next.length - 1));
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return next;
  next.splice(target, 0, moved);
  return next;
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `pnpm vitest run apps/web/src/lib/move-item.test.ts`
Expected: PASS (6개)

- [ ] **Step 5: 커밋**

```bash
git add apps/web/src/lib/move-item.ts apps/web/src/lib/move-item.test.ts
git commit -m "feat(web): add a pure list reorder helper"
```

---

### Task 6: 드래그 핸들 목록과 화면 연결

**Files:**
- Create: `apps/web/src/components/schematic/project-order-list.tsx`
- Create: `apps/web/src/components/schematic/project-order-list.test.ts`
- Modify: `apps/web/src/app/page.tsx:62-72`
- Modify: `apps/web/src/app/page.test.ts:43-51`

**Interfaces:**
- Consumes:
  - `moveItem(items: readonly string[], from: number, to: number): string[]` (Task 5)
  - `reorderProjects(orderedIds: string[]): Promise<{ status: 'success' | 'stale' | 'error' }>` (Task 3)
- Produces:
  - `type ProjectOrderItem = { id: string; name: string; node: ReactNode }`
  - `ProjectOrderList({ items }: { items: ProjectOrderItem[] })`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

이 저장소의 컴포넌트 테스트는 소스 텍스트를 검사한다 (`project-sheet.test.ts`, `page.test.ts`가 같은 방식이다). 드래그 제스처 자체는 검증하지 않는다. jsdom에는 레이아웃이 없어 `getBoundingClientRect()`가 전부 0을 돌려주므로 중앙선 판정을 의미 있게 확인할 수 없다.

`apps/web/src/components/schematic/project-order-list.test.ts`를 만든다.

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = (relativePath: string) => readFileSync(
  fileURLToPath(new URL(relativePath, import.meta.url)),
  'utf8',
);

const LIST = source('./project-order-list.tsx');

describe('project order list', () => {
  it('클라이언트 컴포넌트로 목록을 소유한다', () => {
    expect(LIST).toContain("'use client'");
    expect(LIST).toContain('<ul ref={listRef} className="space-y-4">');
  });

  it('핸들에서만 드래그를 시작하고 스크롤에 먹히지 않게 한다', () => {
    expect(LIST).toContain('onPointerDown');
    expect(LIST).toContain('setPointerCapture');
    expect(LIST).toContain('touch-none');
  });

  it('놓는 순간 서버 액션으로 저장하고 실패하면 서버 상태로 되돌린다', () => {
    expect(LIST).toContain('reorderProjects');
    expect(LIST).toContain('router.refresh()');
  });

  it('키보드로도 같은 저장 경로를 쓴다', () => {
    expect(LIST).toContain("case 'ArrowUp'");
    expect(LIST).toContain("case 'ArrowDown'");
    expect(LIST).toContain('event.preventDefault()');
  });

  it('이동 결과를 스크린 리더에 알린다', () => {
    expect(LIST).toContain('aria-label={`${item.name} 순서 이동`}');
    expect(LIST).toContain('aria-live="polite"');
    expect(LIST).toContain('번째');
  });

  it('재배치 계산을 순수 함수에 맡긴다', () => {
    expect(LIST).toContain("from '../../lib/move-item'");
    expect(LIST).toContain('moveItem(');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인한다**

Run: `pnpm vitest run apps/web/src/components/schematic/project-order-list.test.ts`
Expected: FAIL — `ENOENT ... project-order-list.tsx`

- [ ] **Step 3: 컴포넌트를 구현한다**

`apps/web/src/components/schematic/project-order-list.tsx`를 만든다.

```tsx
'use client';

import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { reorderProjects } from '../../actions/projects';
import { moveItem } from '../../lib/move-item';

export type ProjectOrderItem = {
  id: string;
  name: string;
  node: ReactNode;
};

export function ProjectOrderList({ items }: { items: ProjectOrderItem[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [order, setOrder] = useState(() => items.map((item) => item.id));
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const orderRef = useRef(order);

  // 서버가 새 목록을 보내면 (승인, 삭제, refresh) 낙관적 순서를 버린다.
  const serverOrder = items.map((item) => item.id).join('\n');
  useEffect(() => {
    const next = serverOrder ? serverOrder.split('\n') : [];
    setOrder(next);
    orderRef.current = next;
  }, [serverOrder]);

  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  const save = useCallback((next: string[]) => {
    startTransition(async () => {
      const result = await reorderProjects(next);
      if (result.status !== 'success') router.refresh();
    });
  }, [router]);

  // 매번 살아 있는 DOM 을 읽는다. 미리 모아 둔 좌표는 재배치 직후
  // 어긋나므로, 항목이 수십 개인 이 화면에서는 이쪽이 더 안전하다.
  const indexAtPointer = useCallback((clientY: number): number => {
    const nodes = listRef.current?.children;
    if (!nodes) return -1;
    for (let index = 0; index < nodes.length; index += 1) {
      const rect = nodes[index]?.getBoundingClientRect();
      if (!rect) continue;
      if (clientY < rect.top + rect.height / 2) return index;
    }
    return nodes.length - 1;
  }, []);

  function handlePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
    id: string,
  ) {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDraggingId(id);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!draggingId) return;
    const from = orderRef.current.indexOf(draggingId);
    const to = indexAtPointer(event.clientY);
    if (from === -1 || to === -1 || to === from) return;
    const next = moveItem(orderRef.current, from, to);
    orderRef.current = next;
    setOrder(next);
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!draggingId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraggingId(null);
    save(orderRef.current);
  }

  function handleKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    item: ProjectOrderItem,
  ) {
    const from = orderRef.current.indexOf(item.id);
    if (from === -1) return;

    let to = from;
    switch (event.key) {
      case 'ArrowUp':
        to = from - 1;
        break;
      case 'ArrowDown':
        to = from + 1;
        break;
      default:
        return;
    }
    if (to < 0 || to >= orderRef.current.length) return;

    event.preventDefault();
    const next = moveItem(orderRef.current, from, to);
    orderRef.current = next;
    setOrder(next);
    setAnnouncement(`${item.name}, ${to + 1}번째`);
    save(next);
  }

  const itemById = new Map(items.map((item) => [item.id, item]));

  return (
    <>
      <ul ref={listRef} className="space-y-4">
        {order.map((id) => {
          const item = itemById.get(id);
          if (!item) return null;

          return (
            <li
              key={id}
              className={draggingId === id
                ? 'flex min-w-0 gap-2 opacity-60'
                : 'flex min-w-0 gap-2'}
            >
              <button
                type="button"
                aria-label={`${item.name} 순서 이동`}
                className="mt-4 h-7 w-5 shrink-0 cursor-grab touch-none rounded text-[var(--absent)] hover:bg-[var(--rule)] hover:text-[var(--line)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--line)]"
                onPointerDown={(event) => handlePointerDown(event, id)}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onKeyDown={(event) => handleKeyDown(event, item)}
              >
                ⠿
              </button>
              <div className="min-w-0 flex-1">{item.node}</div>
            </li>
          );
        })}
      </ul>
      <p aria-live="polite" className="sr-only">{announcement}</p>
    </>
  );
}
```

- [ ] **Step 4: 컴포넌트 테스트가 통과하는지 확인한다**

Run: `pnpm vitest run apps/web/src/components/schematic/project-order-list.test.ts`
Expected: PASS (6개)

- [ ] **Step 5: 화면 테스트를 고친다**

`apps/web/src/app/page.test.ts:43-51`의 테스트가 `<ul className="space-y-4">`를 `page.tsx`에서 찾는다. 목록 소유가 컴포넌트로 옮겨 갔으므로 아래로 바꾼다.

```ts
  it('renders one semantic list of project sheets at every viewport', () => {
    const home = source('./page.tsx');
    const orderList = source('../components/schematic/project-order-list.tsx');

    expect(home).toContain('<ProjectOrderList');
    expect(orderList).toContain('<ul ref={listRef} className="space-y-4">');
    expect(home).toContain('<ProjectSheet');
    expect(home).not.toContain('<Table');
    expect(home).not.toContain('md:hidden');
    expect(home).not.toContain('hidden md:block');
  });
```

- [ ] **Step 6: 테스트가 실패하는지 확인한다**

Run: `pnpm vitest run apps/web/src/app/page.test.ts`
Expected: FAIL — `page.tsx`에 `<ProjectOrderList`가 없다

- [ ] **Step 7: 화면을 연결한다**

`apps/web/src/app/page.tsx`의 import에 컴포넌트를 더한다.

```ts
import { ProjectOrderList } from '@/components/schematic/project-order-list';
```

`rows.length > 0` 분기의 `<ul>` 블록을 바꾼다.

```tsx
        {rows.length > 0 ? (
          <ProjectOrderList
            items={rows.map((project) => ({
              id: project.id,
              name: project.name,
              node: (
                <ProjectSheet
                  project={project}
                  tone={STATUS_TONES[project.judgement]}
                />
              ),
            }))}
          />
        ) : (
```

빈 목록 안내와 아래쪽 발견 링크는 그대로 둔다. `page.tsx`에 `'use client'`를 넣지 않는다. `ProjectSheet`는 서버에서 렌더되어 노드로 넘어가므로 `componentObservations`의 `Map`이 클라이언트 경계를 넘지 않는다.

- [ ] **Step 8: 화면 테스트가 통과하는지 확인한다**

Run: `pnpm vitest run apps/web/src/app/page.test.ts apps/web/src/components/schematic/project-sheet.test.ts apps/web/src/app/responsive-layout.test.ts`
Expected: PASS

- [ ] **Step 9: 전체 검증**

```bash
pnpm typecheck
pnpm test
pnpm --filter web build
```

Expected: 셋 다 성공. `pnpm test`는 Docker 데몬이 떠 있어야 하고 3분 정도 걸린다.

- [ ] **Step 10: 커밋**

```bash
git add apps/web/src/components/schematic/project-order-list.tsx apps/web/src/components/schematic/project-order-list.test.ts apps/web/src/app/page.tsx apps/web/src/app/page.test.ts
git commit -m "feat(web): reorder the project list with drag handles"
```

---

## 배포 후 수동 확인

자동 테스트가 덮지 못하는 항목이다. 배포한 뒤 실제 화면에서 확인한다.

- [ ] 마우스로 핸들을 잡고 카드를 다른 자리에 놓으면 순서가 바뀌고, 새로고침 후에도 유지된다.
- [ ] 다른 브라우저나 기기에서 같은 순서로 보인다.
- [ ] 모바일에서 핸들을 눌러 끌면 페이지가 스크롤되지 않고 카드가 따라온다.
- [ ] 카드 이름 링크, 접기 화살표, 구성요소 URL이 드래그 도입 전과 똑같이 눌린다.
- [ ] 핸들에 Tab 으로 포커스한 뒤 `↑` `↓`로 한 칸씩 이동하고, 페이지가 스크롤되지 않는다.
- [ ] Draft 를 승인하면 새 프로젝트가 목록 맨 위에 나타난다.
