# Project History Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep project detail pages focused by showing only five recent changes, while turning `/events` into a filterable, cursor-paginated history explorer.

**Architecture:** Add one pure server-side helper that validates URL filters and builds stable history links. Reuse the existing `listTimelineEvents` project/severity/kind/cursor contract, keep rendering in server components, and extend `TimelineList` only with optional project context.

**Tech Stack:** Next.js 16 App Router server components, React 19, TypeScript 6, Drizzle ORM, Vitest, Tailwind CSS

---

## File map

- Create: `apps/web/src/app/events/event-filters.ts` — validate `searchParams`, resolve project slugs, and build filter-preserving URLs.
- Create: `apps/web/src/app/events/event-filters.test.ts` — behavior tests for valid, invalid, combined, and cursor filters.
- Modify: `apps/web/src/app/events/page.tsx` — render the GET filter form, query 50 events, and link to the next cursor.
- Modify: `apps/web/src/app/events/page.test.ts` — verify server filtering, accessible controls, pagination, and optional project labels.
- Modify: `apps/web/src/components/events/timeline-list.tsx` — show project context only when a project-name map is supplied.
- Modify: `apps/web/src/app/projects/[slug]/page.tsx` — request five history rows and link to the project-filtered `/events` page when more exist.
- Modify: `apps/web/src/app/projects/[slug]/page.test.ts` — verify the five-row summary and conditional full-history link.

### Task 1: URL filter parser and history URL builder

**Files:**
- Create: `apps/web/src/app/events/event-filters.ts`
- Create: `apps/web/src/app/events/event-filters.test.ts`

- [ ] **Step 1: Write failing parser and URL tests**

Create `apps/web/src/app/events/event-filters.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildEventsHref,
  parseEventFilters,
} from './event-filters';

const projects = [
  { id: 'project-1', slug: 'deployhub', name: 'DeployHub' },
  { id: 'project-2', slug: 'yield', name: 'Yield' },
];

describe('event filters', () => {
  it('parses and resolves valid combined filters', () => {
    expect(parseEventFilters({
      project: 'deployhub',
      severity: 'critical',
      kind: 'health_status',
      cursor: '42',
    }, projects)).toEqual({
      projectSlug: 'deployhub',
      projectId: 'project-1',
      severity: 'critical',
      kind: 'health_status',
      cursor: 42n,
    });
  });

  it('ignores unknown, repeated, and invalid values independently', () => {
    expect(parseEventFilters({
      project: 'missing',
      severity: 'urgent',
      kind: ['deployment', 'health_status'],
      cursor: '-1',
    }, projects)).toEqual({
      projectSlug: '',
      projectId: null,
      severity: undefined,
      kind: undefined,
      cursor: undefined,
    });
  });

  it.each([
    '0',
    '-2',
    '1.2',
    'abc',
    '',
    '9223372036854775808',
  ])('ignores invalid cursor %s', (cursor) => {
    expect(parseEventFilters({ cursor }, projects).cursor).toBeUndefined();
  });

  it('builds a stable encoded URL with only selected filters', () => {
    expect(buildEventsHref({
      projectSlug: 'deploy hub',
      severity: 'warning',
      kind: 'sync_failure',
    }, 77n)).toBe(
      '/events?project=deploy+hub&severity=warning&kind=sync_failure&cursor=77',
    );
  });

  it('omits empty filters and cursor', () => {
    expect(buildEventsHref({
      projectSlug: '',
      severity: undefined,
      kind: undefined,
    })).toBe('/events');
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm --filter web exec vitest run src/app/events/event-filters.test.ts
```

Expected: FAIL because `./event-filters` does not exist.

- [ ] **Step 3: Implement the pure helper**

Create `apps/web/src/app/events/event-filters.ts`:

```ts
import {
  changeEventKind,
  eventSeverity,
} from '@deployhub/db';

export type RawEventSearchParams = Record<
  string,
  string | string[] | undefined
>;

export type EventProjectOption = {
  id: string;
  slug: string;
  name: string;
};

export type EventSeverity = (typeof eventSeverity.enumValues)[number];
export type EventKind = (typeof changeEventKind.enumValues)[number];

export type EventFilters = {
  projectSlug: string;
  projectId: string | null;
  severity: EventSeverity | undefined;
  kind: EventKind | undefined;
  cursor: bigint | undefined;
};

export type EventFilterSelection = Pick<
  EventFilters,
  'projectSlug' | 'severity' | 'kind'
>;

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function enumValue<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T | undefined {
  return value !== undefined && allowed.includes(value as T)
    ? value as T
    : undefined;
}

function positiveCursor(value: string | undefined): bigint | undefined {
  if (
    value === undefined
    || value.length > 19
    || !/^[1-9]\d*$/.test(value)
  ) {
    return undefined;
  }
  const cursor = BigInt(value);
  return cursor <= 9_223_372_036_854_775_807n ? cursor : undefined;
}

export function parseEventFilters(
  raw: RawEventSearchParams,
  projects: readonly EventProjectOption[],
): EventFilters {
  const requestedSlug = single(raw.project);
  const project = requestedSlug === undefined
    ? undefined
    : projects.find((candidate) => candidate.slug === requestedSlug);

  return {
    projectSlug: project?.slug ?? '',
    projectId: project?.id ?? null,
    severity: enumValue(single(raw.severity), eventSeverity.enumValues),
    kind: enumValue(single(raw.kind), changeEventKind.enumValues),
    cursor: positiveCursor(single(raw.cursor)),
  };
}

export function buildEventsHref(
  filters: EventFilterSelection,
  cursor?: bigint,
): string {
  const params = new URLSearchParams();
  if (filters.projectSlug !== '') params.set('project', filters.projectSlug);
  if (filters.severity !== undefined) params.set('severity', filters.severity);
  if (filters.kind !== undefined) params.set('kind', filters.kind);
  if (cursor !== undefined) params.set('cursor', cursor.toString());
  const query = params.toString();
  return query === '' ? '/events' : `/events?${query}`;
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm --filter web exec vitest run src/app/events/event-filters.test.ts
```

Expected: 10 tests pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add apps/web/src/app/events/event-filters.ts apps/web/src/app/events/event-filters.test.ts
git commit -m "feat(web): parse project history filters"
```

### Task 2: Filterable and paginated global history page

**Files:**
- Modify: `apps/web/src/app/events/page.tsx`
- Modify: `apps/web/src/app/events/page.test.ts`
- Modify: `apps/web/src/components/events/timeline-list.tsx`

- [ ] **Step 1: Add failing page and project-label tests**

Append these tests inside the existing `describe('global events timeline', ...)`
block in `apps/web/src/app/events/page.test.ts`:

```ts
  it('validates URL filters and applies them to a 50-row query', () => {
    expect(page).toContain('searchParams');
    expect(page).toContain('parseEventFilters');
    expect(page).toContain('listProjects(db)');
    expect(page).toContain('projectId: filters.projectId');
    expect(page).toContain('severity: filters.severity');
    expect(page).toContain('kind: filters.kind');
    expect(page).toContain('cursor: filters.cursor');
    expect(page).toContain('limit: 50');
  });

  it('renders accessible GET filters without carrying the cursor', () => {
    expect(page).toContain('<form');
    expect(page).toContain('name="project"');
    expect(page).toContain('name="severity"');
    expect(page).toContain('name="kind"');
    expect(page).not.toContain('name="cursor"');
    expect(page).toContain('필터 적용');
    expect(page).toContain('필터 초기화');
  });

  it('preserves validated filters on the next-page link', () => {
    expect(page).toContain('buildEventsHref(filters, nextCursor)');
    expect(page).toContain('다음 기록 보기');
  });

  it('shows project context only when the page is not project-scoped', () => {
    expect(page).toContain(
      'projectNames={filters.projectId === null ? projectNames : undefined}',
    );
    expect(timeline).toContain('projectNames?: ReadonlyMap<string, string>');
    expect(timeline).toContain("event.projectId === null ? '전역'");
    expect(timeline).toContain("?? '삭제된 프로젝트'");
  });
```

- [ ] **Step 2: Run the event-page tests and verify RED**

Run:

```bash
pnpm --filter web exec vitest run src/app/events/page.test.ts
```

Expected: FAIL because the page has no filters, next link, or project labels.

- [ ] **Step 3: Replace the global history page with server-rendered filtering**

Replace `apps/web/src/app/events/page.tsx` with:

```tsx
import Link from 'next/link';
import {
  changeEventKind,
  eventSeverity,
  listProjects,
  listTimelineEvents,
} from '@deployhub/db';
import { TimelineList } from '@/components/events/timeline-list';
import { Topbar } from '@/components/shell/topbar';
import { Button } from '@/components/ui/button';
import { db } from '@/lib/db';
import {
  buildEventsHref,
  parseEventFilters,
  type EventKind,
  type EventSeverity,
  type RawEventSearchParams,
} from './event-filters';

export const dynamic = 'force-dynamic';

const SEVERITY_LABELS: Record<EventSeverity, string> = {
  info: '정보',
  warning: '주의',
  critical: '장애',
};

const KIND_LABELS: Record<EventKind, string> = {
  health_status: 'HTTP 상태',
  container_status: '컨테이너 상태',
  container_health: '컨테이너 헬스',
  deployment: '배포',
  ssl_expiry: 'SSL 만료',
  sync_failure: '동기화 실패',
};

const SELECT_CLASS = 'mt-1 block h-9 w-full rounded-[var(--radius-button)] border border-[var(--rule)] bg-[var(--paper)] px-3 font-mono text-sm text-[var(--line)]';

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<RawEventSearchParams>;
}) {
  const renderedAt = new Date();
  const [projects, rawFilters] = await Promise.all([
    listProjects(db),
    searchParams,
  ]);
  const filters = parseEventFilters(rawFilters, projects);
  const { events, nextCursor } = await listTimelineEvents(db, {
    projectId: filters.projectId,
    severity: filters.severity,
    kind: filters.kind,
    cursor: filters.cursor,
    limit: 50,
  });
  const projectNames = new Map(
    projects.map((project) => [project.id, project.name]),
  );
  const nextHref = nextCursor === null
    ? null
    : buildEventsHref(filters, nextCursor);

  return (
    <>
      <Topbar title="변경" />
      <main className="space-y-6 p-4 md:p-8">
        <div>
          <h2 className="text-xl font-medium text-[var(--line)]">
            변경 이력
          </h2>
          <p className="mt-1 text-sm text-[var(--annotation)]">
            최근 상태 전환을 프로젝트와 이벤트 조건으로 탐색합니다.
          </p>
        </div>

        <form className="grid gap-3 rounded-[var(--radius-card)] border border-[var(--rule)] bg-[var(--paper)] p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_14rem_auto] lg:items-end">
          <label className="text-xs text-[var(--annotation)]">
            프로젝트
            <select
              name="project"
              defaultValue={filters.projectSlug}
              className={SELECT_CLASS}
            >
              <option value="">전체 프로젝트</option>
              {projects.map((project) => (
                <option key={project.id} value={project.slug}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--annotation)]">
            심각도
            <select
              name="severity"
              defaultValue={filters.severity ?? ''}
              className={SELECT_CLASS}
            >
              <option value="">전체 심각도</option>
              {eventSeverity.enumValues.map((severity) => (
                <option key={severity} value={severity}>
                  {SEVERITY_LABELS[severity]} ({severity})
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--annotation)]">
            변경 종류
            <select
              name="kind"
              defaultValue={filters.kind ?? ''}
              className={SELECT_CLASS}
            >
              <option value="">전체 변경 종류</option>
              {changeEventKind.enumValues.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABELS[kind]} ({kind})
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit">필터 적용</Button>
            <Link
              href="/events"
              className="inline-flex h-9 items-center px-2 text-sm text-[var(--line-mute)] hover:text-[var(--line)]"
            >
              필터 초기화
            </Link>
          </div>
        </form>

        <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--rule)] bg-[var(--paper)]">
          <TimelineList
            events={events}
            renderedAt={renderedAt}
            projectNames={filters.projectId === null ? projectNames : undefined}
          />
        </section>

        {nextHref === null ? null : (
          <div className="flex justify-end">
            <Link
              href={nextHref}
              className="inline-flex h-9 items-center rounded-[var(--radius-button)] border border-[var(--rule)] bg-[var(--paper)] px-3 text-sm font-medium text-[var(--line)] hover:bg-white/[0.02]"
            >
              다음 기록 보기
            </Link>
          </div>
        )}
      </main>
    </>
  );
}
```

- [ ] **Step 4: Extend `TimelineList` with optional project context**

In `apps/web/src/components/events/timeline-list.tsx`, add the prop and derive the
label inside the existing `rows.map` callback:

```tsx
export function TimelineList({
  events,
  renderedAt,
  emptyMessage = '아직 기록된 변경이 없습니다',
  projectNames,
}: {
  events: TimelineEvent[];
  renderedAt: Date;
  emptyMessage?: string;
  projectNames?: ReadonlyMap<string, string>;
}) {
```

Replace the map callback opening with:

```tsx
      {rows.map(({ event, relativeTime }) => {
        const projectName = projectNames === undefined
          ? null
          : event.projectId === null ? '전역'
            : projectNames.get(event.projectId) ?? '삭제된 프로젝트';
        return (
```

Place this label before the existing event kind inside the right-hand event
content:

```tsx
              {projectName === null ? null : (
                <span className="text-xs font-medium text-[var(--line)]">
                  {projectName}
                </span>
              )}
```

Close the callback after the existing `</li>`:

```tsx
        );
      })}
```

- [ ] **Step 5: Run the helper and event-page tests**

Run:

```bash
pnpm --filter web exec vitest run src/app/events/event-filters.test.ts src/app/events/page.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 6: Run web type checking**

Run:

```bash
pnpm --filter web typecheck
```

Expected: exit 0 with no TypeScript errors.

- [ ] **Step 7: Commit Task 2**

```bash
git add apps/web/src/app/events/page.tsx apps/web/src/app/events/page.test.ts apps/web/src/components/events/timeline-list.tsx
git commit -m "feat(web): filter project change history"
```

### Task 3: Five-row project history summary and full-history link

**Files:**
- Modify: `apps/web/src/app/projects/[slug]/page.tsx`
- Modify: `apps/web/src/app/projects/[slug]/page.test.ts`

- [ ] **Step 1: Update the project-page test to specify the new behavior**

Replace the `keeps current evidence separate from a project-scoped history timeline`
test in `apps/web/src/app/projects/[slug]/page.test.ts` with:

```ts
  it('shows five recent changes and links to additional project history', () => {
    const evidence = page.indexOf('판정 근거');
    const deployments = page.indexOf('최종 배포');
    const timeline = page.indexOf('최근 변경');

    expect(page).toContain('listTimelineEvents(db, {');
    expect(page).toContain('projectId: project.id');
    expect(page).toContain('limit: 5');
    expect(page).not.toContain('limit: 20');
    expect(page).toContain(
      'const { events: historyEvents, nextCursor: historyNextCursor }',
    );
    expect(page).toContain('excludeIds: [...evidenceEventIds]');
    expect(page).toContain('events={historyEvents}');
    expect(page).toContain('최근 {historyEvents.length}건');
    expect(page).toContain('historyNextCursor === null ? null');
    expect(page).toContain('buildEventsHref({');
    expect(page).toContain('projectSlug: project.slug');
    expect(page).toContain('전체 변경 이력 보기');
    expect(page).not.toContain('timelinePage.events.filter');
    expect(page).toContain(
      'emptyMessage="현재 판정 근거 외에 기록된 변경이 없습니다"',
    );
    expect(evidence).toBeLessThan(deployments);
    expect(deployments).toBeLessThan(timeline);
  });
```

- [ ] **Step 2: Run the project-page test and verify RED**

Run:

```bash
pnpm --filter web exec vitest run 'src/app/projects/[slug]/page.test.ts'
```

Expected: FAIL because the page still requests 20 events and has no full-history link.

- [ ] **Step 3: Implement the five-row summary**

Add this import to `apps/web/src/app/projects/[slug]/page.tsx`:

```ts
import { buildEventsHref } from '../../events/event-filters';
```

Replace the timeline query with:

```ts
  const {
    events: historyEvents,
    nextCursor: historyNextCursor,
  } = await listTimelineEvents(db, {
    projectId: project.id,
    excludeIds: [...evidenceEventIds],
    limit: 5,
  });
```

Replace the existing change-history card header with:

```tsx
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-base font-medium text-[var(--line)]">
                최근 변경
              </h3>
              <span className="text-xs text-[var(--annotation)]">
                최근 {historyEvents.length}건
              </span>
            </div>
            {historyNextCursor === null ? null : (
              <Link
                href={buildEventsHref({
                  projectSlug: project.slug,
                  severity: undefined,
                  kind: undefined,
                })}
                className="text-sm text-[var(--line-mute)] hover:text-[var(--line)]"
              >
                전체 변경 이력 보기
              </Link>
            )}
          </div>
```

Keep the existing `TimelineList`, border wrapper, and empty message unchanged.

- [ ] **Step 4: Run the project and event tests**

Run:

```bash
pnpm --filter web exec vitest run 'src/app/projects/[slug]/page.test.ts' src/app/events/event-filters.test.ts src/app/events/page.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 5: Run web type checking**

Run:

```bash
pnpm --filter web typecheck
```

Expected: exit 0.

- [ ] **Step 6: Commit Task 3**

```bash
git add 'apps/web/src/app/projects/[slug]/page.tsx' 'apps/web/src/app/projects/[slug]/page.test.ts'
git commit -m "feat(web): summarize project change history"
```

### Task 4: Full verification

**Files:**
- Verify: all files changed in Tasks 1–3

- [ ] **Step 1: Run focused history tests**

```bash
pnpm --filter web exec vitest run src/app/events/event-filters.test.ts src/app/events/page.test.ts 'src/app/projects/[slug]/page.test.ts'
```

Expected: all focused tests pass.

- [ ] **Step 2: Run workspace type checking**

```bash
pnpm typecheck
```

Expected: all workspace type checks exit 0.

- [ ] **Step 3: Run the full test suite**

```bash
pnpm test
```

Expected: all test files and tests pass. Allow at least 10 minutes because PostgreSQL Testcontainers make the suite take about three minutes.

- [ ] **Step 4: Build the production web application**

```bash
pnpm --filter web build
```

Expected: optimized production build exits 0. The existing workspace-root and middleware deprecation warnings may remain.

- [ ] **Step 5: Check scope and repository cleanliness**

```powershell
git diff --check main...HEAD
git diff --stat main...HEAD
git status --short
```

Expected: diff check exits 0; only the planned history files and this implementation plan changed; worktree is clean.
