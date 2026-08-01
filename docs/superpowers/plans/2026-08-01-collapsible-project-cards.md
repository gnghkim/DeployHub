# Collapsible Project Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users collapse each project card independently while retaining its identity and status header and restoring the choice from browser storage.

**Architecture:** Keep project data preparation and detailed markup in the server-rendered `ProjectSheet`. Add one focused client wrapper that owns the chevron, accessibility state, detail visibility, and versioned per-project `localStorage` key; pass header and detail markup across the client boundary as React nodes so the server-only observation `Map` is never serialized.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, Tailwind CSS, Vitest 4, happy-dom

---

## File structure

- Create `apps/web/src/components/schematic/project-sheet-collapse.tsx`: client-only collapse state, persistence, chevron, header shell, and detail visibility.
- Create `apps/web/src/components/schematic/project-sheet-collapse.test.tsx`: DOM interaction, persistence, isolation, storage-failure, and accessibility tests.
- Modify `apps/web/src/components/schematic/project-sheet.tsx`: keep server-side project rendering and pass header/detail React nodes into the collapse wrapper.
- Modify `apps/web/src/components/schematic/project-sheet-render.test.ts`: verify the integrated default markup, name link, status/time header, and controlled detail region.

### Task 1: Build the persisted collapse state component

**Files:**
- Create: `apps/web/src/components/schematic/project-sheet-collapse.test.tsx`
- Create: `apps/web/src/components/schematic/project-sheet-collapse.tsx`

- [ ] **Step 1: Write the failing interaction and persistence tests**

Create `apps/web/src/components/schematic/project-sheet-collapse.test.tsx`:

```tsx
// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectSheetCollapse } from './project-sheet-collapse';

const STORAGE_PREFIX = 'deployhub:project-card-collapsed:v1:';

describe('ProjectSheetCollapse', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  async function renderCard({
    projectId = 'project-1',
    projectName = 'DeployHub',
    header = <span data-header>status</span>,
    trailing = <time data-trailing>1분 전</time>,
    children = <div data-details>repository and components</div>,
  }: {
    projectId?: string;
    projectName?: string;
    header?: ReactNode;
    trailing?: ReactNode;
    children?: ReactNode;
  } = {}) {
    await act(async () => {
      root.render(
        <ProjectSheetCollapse
          projectId={projectId}
          projectName={projectName}
          header={header}
          trailing={trailing}
        >
          {children}
        </ProjectSheetCollapse>,
      );
    });
  }

  it('starts expanded and exposes an accessible controlled region', async () => {
    await renderCard();

    const button = container.querySelector('button');
    const details = container.querySelector<HTMLElement>('[data-details]')
      ?.parentElement;

    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(button?.getAttribute('aria-label')).toBe('DeployHub 접기');
    expect(button?.getAttribute('aria-controls')).toBe(details?.id);
    expect(details?.hidden).toBe(false);
  });

  it('collapses only the details, persists the choice, and expands again', async () => {
    await renderCard();

    const button = container.querySelector('button');
    const details = container.querySelector<HTMLElement>('[data-details]')
      ?.parentElement;

    await act(async () => button?.click());

    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(button?.getAttribute('aria-label')).toBe('DeployHub 펼치기');
    expect(details?.hidden).toBe(true);
    expect(container.querySelector('[data-header]')).not.toBeNull();
    expect(container.querySelector('[data-trailing]')).not.toBeNull();
    expect(localStorage.getItem(`${STORAGE_PREFIX}project-1`)).toBe('1');

    await act(async () => button?.click());

    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(details?.hidden).toBe(false);
    expect(localStorage.getItem(`${STORAGE_PREFIX}project-1`)).toBeNull();
  });

  it('restores a stored project state without affecting another project', async () => {
    localStorage.setItem(`${STORAGE_PREFIX}project-1`, '1');

    await act(async () => {
      root.render(
        <>
          <ProjectSheetCollapse
            projectId="project-1"
            projectName="DeployHub"
            header={<span>DeployHub status</span>}
          >
            <span data-project="project-1">details</span>
          </ProjectSheetCollapse>
          <ProjectSheetCollapse
            projectId="project-2"
            projectName="Yield"
            header={<span>Yield status</span>}
          >
            <span data-project="project-2">details</span>
          </ProjectSheetCollapse>
        </>,
      );
    });

    expect(
      container.querySelector<HTMLElement>('[data-project="project-1"]')
        ?.parentElement?.hidden,
    ).toBe(true);
    expect(
      container.querySelector<HTMLElement>('[data-project="project-2"]')
        ?.parentElement?.hidden,
    ).toBe(false);
  });

  it('keeps toggling in memory when browser storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    await renderCard();
    const button = container.querySelector('button');
    const details = container.querySelector<HTMLElement>('[data-details]')
      ?.parentElement;

    await act(async () => button?.click());

    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(details?.hidden).toBe(true);
  });
});
```

- [ ] **Step 2: Run the new test to verify it fails**

Run:

```powershell
pnpm exec vitest run apps/web/src/components/schematic/project-sheet-collapse.test.tsx
```

Expected: FAIL because `./project-sheet-collapse` does not exist.

- [ ] **Step 3: Implement the minimal client collapse component**

Create `apps/web/src/components/schematic/project-sheet-collapse.tsx`:

```tsx
'use client';

import { useEffect, useState, type ReactNode } from 'react';

const STORAGE_PREFIX = 'deployhub:project-card-collapsed:v1:';

export function ProjectSheetCollapse({
  children,
  header,
  projectId,
  projectName,
  trailing = null,
}: {
  children: ReactNode;
  header: ReactNode;
  projectId: string;
  projectName: string;
  trailing?: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const detailsId = `project-card-details-${projectId}`;
  const storageKey = `${STORAGE_PREFIX}${projectId}`;

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(storageKey) === '1');
    } catch {
      // Storage may be unavailable; the in-memory state still works.
    }
  }, [storageKey]);

  function toggle() {
    setCollapsed((current) => {
      const next = !current;
      try {
        if (next) {
          localStorage.setItem(storageKey, '1');
        } else {
          localStorage.removeItem(storageKey);
        }
      } catch {
        // Storage may be unavailable; keep the state change in memory.
      }
      return next;
    });
  }

  return (
    <>
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <button
            type="button"
            className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded text-sm text-[var(--annotation)] hover:bg-[var(--wash)] hover:text-[var(--line)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--line)]"
            aria-controls={detailsId}
            aria-expanded={!collapsed}
            aria-label={`${projectName} ${collapsed ? '펼치기' : '접기'}`}
            onClick={toggle}
          >
            <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span>
          </button>
          <div className="flex min-w-0 flex-wrap items-baseline gap-2">
            {header}
          </div>
        </div>
        {trailing}
      </header>
      <div id={detailsId} hidden={collapsed}>
        {children}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```powershell
pnpm exec vitest run apps/web/src/components/schematic/project-sheet-collapse.test.tsx
```

Expected: 4 tests pass with zero failures.

- [ ] **Step 5: Type-check the web package**

Run:

```powershell
pnpm --filter web typecheck
```

Expected: exit code 0.

- [ ] **Step 6: Commit the focused component**

```powershell
git add apps/web/src/components/schematic/project-sheet-collapse.tsx apps/web/src/components/schematic/project-sheet-collapse.test.tsx
git commit -m "feat(web): persist project card collapse state"
```

### Task 2: Integrate collapse behavior into project sheets

**Files:**
- Modify: `apps/web/src/components/schematic/project-sheet.tsx`
- Modify: `apps/web/src/components/schematic/project-sheet-render.test.ts`

- [ ] **Step 1: Add failing integration assertions**

In `apps/web/src/components/schematic/project-sheet-render.test.ts`, add a fixed deployment time to the test project and this test:

```tsx
it('renders a collapsible header while keeping the detail link and status metadata', () => {
  const deploymentAt = new Date('2026-08-01T00:00:00.000Z');
  const markup = renderToStaticMarkup(createElement(ProjectSheet, {
    project: {
      ...baseProject,
      judgement: '장애',
      latestDeploymentAt: deploymentAt,
      latestDeploymentRelative: '1일 전',
      repository: 'gnghkim/DeployHub',
    },
    tone: 'fault',
  }));

  expect(markup).toContain('aria-label="DeployHub 접기"');
  expect(markup).toContain('aria-expanded="true"');
  expect(markup).toContain('aria-controls="project-card-details-project-1"');
  expect(markup).toContain('id="project-card-details-project-1"');
  expect(markup).toContain('href="/projects/deployhub"');
  expect(markup).toContain('>장애</span>');
  expect(markup).toContain('>1일 전</time>');
  expect(markup).toContain('gnghkim/DeployHub');
});
```

- [ ] **Step 2: Run the integration test to verify it fails**

Run:

```powershell
pnpm exec vitest run apps/web/src/components/schematic/project-sheet-render.test.ts
```

Expected: the new assertions fail because `ProjectSheet` has no collapse button or controlled detail region.

- [ ] **Step 3: Wrap the existing header and details with the collapse component**

Add the import to `project-sheet.tsx`:

```tsx
import { ProjectSheetCollapse } from './project-sheet-collapse';
```

Replace the current `Sheet` children with this structure while retaining the existing repository/component list unchanged inside the child `<div>`:

```tsx
<Sheet className="min-w-0 overflow-hidden">
  <ProjectSheetCollapse
    projectId={project.id}
    projectName={project.name}
    header={(
      <>
        <StatusDot tone={tone} />
        <Link
          href={`/projects/${project.slug}`}
          className="min-w-0 break-words text-[15px] font-medium text-[var(--line)] hover:underline"
        >
          {project.name}
        </Link>
        <Badge tone={tone}>{project.judgement}</Badge>
      </>
    )}
    trailing={project.latestDeploymentAt && project.latestDeploymentRelative ? (
      <time
        className="shrink-0 text-xs text-[var(--absent)]"
        dateTime={project.latestDeploymentAt.toISOString()}
        title={formatDateTime(project.latestDeploymentAt)}
      >
        {project.latestDeploymentRelative}
      </time>
    ) : null}
  >
    <div className="mt-4 min-w-0 border-t border-[var(--rule)] pt-4 font-mono text-[13px]">
      <ul className="min-w-0 space-y-2">
        {project.repository ? (
          <li className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[var(--line-mute)]">
            <span className="shrink-0 text-[var(--annotation)]">github</span>
            <span className="min-w-0 break-all">{project.repository}</span>
          </li>
        ) : null}

        {project.deploymentLabel ? (
          <li className="min-w-0">
            <div className="flex min-w-0 items-baseline gap-2 text-[var(--line-mute)]">
              <span
                aria-hidden="true"
                className="shrink-0 text-[var(--absent)]"
              >
                └─
              </span>
              <span className="min-w-0 break-words">
                {project.deploymentLabel}
              </span>
            </div>
            {componentItems.length > 0 ? (
              <ul className="ml-2 mt-2 min-w-0 space-y-2 sm:ml-4">
                {componentItems}
              </ul>
            ) : null}
          </li>
        ) : componentItems.length > 0 ? (
          <li className="min-w-0">
            <ul className="min-w-0 space-y-2">
              {componentItems}
            </ul>
          </li>
        ) : null}
      </ul>
    </div>
  </ProjectSheetCollapse>
</Sheet>
```

Do not move project data preparation into the client component. Do not change the project name link, badge tone, relative time, repository rows, deployment label, component observation, or component URL markup.

- [ ] **Step 4: Run component tests to verify integration passes**

Run:

```powershell
pnpm exec vitest run apps/web/src/components/schematic/project-sheet-collapse.test.tsx apps/web/src/components/schematic/project-sheet-render.test.ts apps/web/src/components/schematic/project-sheet.test.ts apps/web/src/app/page.test.ts
```

Expected: all selected files pass with zero failures.

- [ ] **Step 5: Run web type-check and inspect the production build boundary**

Run:

```powershell
pnpm --filter web typecheck
pnpm --filter web build
```

Expected: both commands exit 0, proving the server/client React-node boundary is serializable by the Next.js production build.

- [ ] **Step 6: Commit the integration**

```powershell
git add apps/web/src/components/schematic/project-sheet.tsx apps/web/src/components/schematic/project-sheet-render.test.ts
git commit -m "feat(web): make project cards collapsible"
```

### Task 3: Verify the complete feature

**Files:**
- No source changes expected.

- [ ] **Step 1: Run focused project-card tests**

```powershell
pnpm exec vitest run apps/web/src/components/schematic/project-sheet-collapse.test.tsx apps/web/src/components/schematic/project-sheet-render.test.ts apps/web/src/components/schematic/project-sheet.test.ts apps/web/src/app/page.test.ts
```

Expected: every selected test passes with zero failures.

- [ ] **Step 2: Run workspace type-check**

```powershell
pnpm typecheck
```

Expected: all seven workspace packages complete type-checking with exit code 0.

- [ ] **Step 3: Run the full regression suite**

```powershell
pnpm test
```

Expected: at least the 86 baseline test files and 664 baseline tests plus the new collapse tests pass with zero failures.

- [ ] **Step 4: Check repository hygiene**

```powershell
git diff --check 69a22fb..HEAD
git status --short
git log --oneline --decorate -5
```

Expected: no whitespace errors, a clean worktree, and only the planned feature commits after design commit `69a22fb`.
