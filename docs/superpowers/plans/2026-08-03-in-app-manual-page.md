# In-App Manual Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a complete AI project-registration manual at `/manual`, reachable from a persistent `사용 매뉴얼` link at the bottom of the DeployHub sidebar.

**Architecture:** Render the existing manual as native React content in a database-free server page, with a small client-only copy-button component for prompt copying. Preserve the four operational navigation items, add the manual link in the sidebar footer, and protect content parity with source-based tests tied to the existing Markdown manual.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, Vitest, happy-dom, Docker Compose

---

## File structure

- Create `apps/web/src/app/manual/manual-copy-button.tsx`: isolated Clipboard API interaction and success/failure feedback.
- Create `apps/web/src/app/manual/manual-copy-button.test.tsx`: browser-like tests for exact copy, temporary success, missing Clipboard API, and rejected writes.
- Create `apps/web/src/app/manual/page.tsx`: static server page containing the full AI registration manual, responsive table of contents, anchored sections, code blocks, checklists, and GitHub reference links.
- Create `apps/web/src/app/manual/page.test.ts`: source-level checks for content coverage, safety boundaries, prompt parity, anchors, responsive layout, and database-free rendering.
- Modify `apps/web/src/components/shell/sidebar-shell.tsx`: add the footer manual link with active and mobile-close behavior.
- Modify `apps/web/src/components/shell/sidebar.test.ts`: preserve the four main items and verify footer placement, route, and active-state accessibility.
- Reference without modifying `docs/ai-project-registration-manual.md`: canonical prose that must be represented in the native page.

### Task 1: Build the reusable manual prompt copy button

**Files:**
- Create: `apps/web/src/app/manual/manual-copy-button.test.tsx`
- Create: `apps/web/src/app/manual/manual-copy-button.tsx`

- [ ] **Step 1: Write the failing copy-button tests**

Create `manual-copy-button.test.tsx` with a happy-dom environment, React root setup, Clipboard API restoration, and these exact behavioral cases:

```tsx
// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualCopyButton } from './manual-copy-button';

describe('ManualCopyButton', () => {
  let container: HTMLDivElement;
  let initialClipboardDescriptor: PropertyDescriptor | undefined;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    initialClipboardDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      'clipboard',
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    if (initialClipboardDescriptor) {
      Object.defineProperty(
        navigator,
        'clipboard',
        initialClipboardDescriptor,
      );
    } else {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function renderButton(text = '등록 요청문') {
    await act(async () => root.render(<ManualCopyButton text={text} />));
  }

  function button() {
    return container.querySelector('button');
  }

  it('copies the complete prompt only after activation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    await renderButton();

    expect(writeText).not.toHaveBeenCalled();
    await act(async () => {
      button()?.click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith('등록 요청문');
    expect(button()?.textContent).toBe('복사됨');
  });

  it('returns to the default label after two seconds', async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    await renderButton();

    await act(async () => {
      button()?.click();
      await Promise.resolve();
    });
    await act(async () => vi.advanceTimersByTimeAsync(2_000));

    expect(button()?.textContent).toBe('요청문 복사');
  });

  it.each([
    ['is unavailable', undefined],
    ['rejects the write', { writeText: vi.fn().mockRejectedValue(new Error('denied')) }],
  ])('shows a safe message when clipboard %s', async (_name, clipboard) => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: clipboard,
    });
    await renderButton('노출하면 안 되는 요청문');

    await act(async () => {
      button()?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      '복사하지 못했습니다. 직접 선택해 주세요.',
    );
    expect(container.textContent).not.toContain('denied');
  });
});
```

- [ ] **Step 2: Run the focused test and verify the red state**

Run:

```powershell
pnpm exec vitest run apps/web/src/app/manual/manual-copy-button.test.tsx
```

Expected: FAIL because `./manual-copy-button` does not exist.

- [ ] **Step 3: Implement the minimal client component**

Create `manual-copy-button.tsx` with this state machine and markup:

```tsx
'use client';

import { useEffect, useState } from 'react';

type CopyState = 'idle' | 'copied' | 'failed';

export function ManualCopyButton({ text }: { text: string }) {
  const [state, setState] = useState<CopyState>('idle');

  useEffect(() => {
    if (state !== 'copied') return;
    const timeout = window.setTimeout(() => setState('idle'), 2_000);
    return () => window.clearTimeout(timeout);
  }, [state]);

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={copy}
        className="rounded-[var(--radius-button)] border border-[var(--rule)] px-3 py-2 text-sm font-medium text-[var(--line)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        {state === 'copied' ? '복사됨' : '요청문 복사'}
      </button>
      <span role="status" aria-live="polite" className="text-xs text-[var(--annotation)]">
        {state === 'failed'
          ? '복사하지 못했습니다. 직접 선택해 주세요.'
          : ''}
      </span>
    </div>
  );
}
```

The caught error and `text` value must not be logged.

- [ ] **Step 4: Run the focused test and verify green**

Run:

```powershell
pnpm exec vitest run apps/web/src/app/manual/manual-copy-button.test.tsx
```

Expected: 4 tests pass, including both rows of the parameterized failure case.

- [ ] **Step 5: Commit the copy component**

```powershell
git add -- apps/web/src/app/manual/manual-copy-button.tsx apps/web/src/app/manual/manual-copy-button.test.tsx
git commit -m "feat: add manual prompt copy control"
```

### Task 2: Render the complete responsive manual page

**Files:**
- Create: `apps/web/src/app/manual/page.test.ts`
- Create: `apps/web/src/app/manual/page.tsx`
- Reference: `docs/ai-project-registration-manual.md`

- [ ] **Step 1: Write the failing page coverage test**

Create `page.test.ts` that reads `page.tsx` and the Markdown manual, then verifies the exact route contract:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const page = readFileSync(
  fileURLToPath(new URL('./page.tsx', import.meta.url)),
  'utf8',
);
const markdown = readFileSync(
  fileURLToPath(
    new URL('../../../../../docs/ai-project-registration-manual.md', import.meta.url),
  ),
  'utf8',
);

const sections = [
  ['scope', '이 매뉴얼의 범위'],
  ['quick-start', '5분 빠른 시작'],
  ['prerequisites', '시작 전에 준비할 것'],
  ['new-project', '신규 프로젝트 등록 맡기기'],
  ['existing-project', '기존 프로젝트 정보 갱신 맡기기'],
  ['ai-procedure', 'AI가 따라야 하는 절차'],
  ['draft-review', 'Draft에서 사용자가 확인할 것'],
  ['safety', '비밀정보와 추측 방지 원칙'],
  ['troubleshooting', '문제가 생겼을 때 다시 요청하기'],
  ['completion-report', 'AI의 완료 보고 예시'],
  ['references', '더 자세한 문서'],
] as const;

describe('in-app manual page', () => {
  it('renders every approved section with a matching table-of-contents anchor', () => {
    for (const [id, title] of sections) {
      expect(page).toContain(`id="${id}"`);
      expect(page).toContain(`href="#${id}"`);
      expect(page).toContain(title);
      expect(markdown).toContain(title);
    }
  });

  it('keeps both delegation prompts and every CLI operation', () => {
    for (const content of [
      'DeployHub 신규 등록을 준비해줘.',
      'DeployHub 등록 정보와 비교해줘.',
      'init --detect',
      'validate',
      'register --draft',
      'status',
      'diff',
      'sync --draft',
    ]) {
      expect(page).toContain(content);
      expect(markdown).toContain(content);
    }
    expect(page.match(/<CopyablePrompt/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it('preserves the deployment and secret-handling boundaries', () => {
    expect(page).toContain('대상 프로젝트의 실제 서비스 배포는 다루지');
    expect(page).toContain('DeployHub 자체 서비스의 배포는 다루지 않습니다');
    expect(page).toContain('토큰 값은 AI 대화에 붙여 넣지 않습니다');
    expect(page).toContain('provider, externalRef, container, 운영 URL은 추측하지 마');
  });

  it('is a database-free server page with responsive navigation', () => {
    expect(page).not.toContain("'use client'");
    expect(page).not.toContain("from '@/lib/db'");
    expect(page).not.toContain('@deployhub/db');
    expect(page).toContain('aria-label="매뉴얼 목차"');
    expect(page).toContain('lg:sticky');
    expect(page).toContain('lg:hidden');
    expect(page).toContain('hidden lg:block');
    expect(page).toContain('overflow-x-auto');
  });
});
```

- [ ] **Step 2: Run the page test and verify the red state**

Run:

```powershell
pnpm exec vitest run apps/web/src/app/manual/page.test.ts
```

Expected: FAIL because `page.tsx` does not exist.

- [ ] **Step 3: Define the page constants and small presentational helpers**

At the top of `page.tsx`, import `Link`, `ReactNode`, `Topbar`, and `ManualCopyButton`. Define:

```tsx
const TABLE_OF_CONTENTS = [
  { id: 'scope', label: '이 매뉴얼의 범위' },
  { id: 'quick-start', label: '5분 빠른 시작' },
  { id: 'prerequisites', label: '시작 전에 준비할 것' },
  { id: 'new-project', label: '신규 프로젝트 등록 맡기기' },
  { id: 'existing-project', label: '기존 프로젝트 정보 갱신 맡기기' },
  { id: 'ai-procedure', label: 'AI가 따라야 하는 절차' },
  { id: 'draft-review', label: 'Draft에서 사용자가 확인할 것' },
  { id: 'safety', label: '비밀정보와 추측 방지 원칙' },
  { id: 'troubleshooting', label: '문제가 생겼을 때 다시 요청하기' },
  { id: 'completion-report', label: 'AI의 완료 보고 예시' },
  { id: 'references', label: '더 자세한 문서' },
] as const;

const NEW_PROJECT_PROMPT = `이 저장소의 실제 기술 구성과 운영 배포 설정을 조사해서 DeployHub 신규 등록을 준비해줘.

- 작업 범위는 DeployHub 프로젝트 등록까지야. 실제 서비스 배포는 하지 마.
- 저장소 루트에서 DeployHub CLI를 사용해 deployhub.yaml을 생성해.
- CLI가 출력한 INFERRED FIELDS와 UNKNOWN FIELDS를 검토하고, 파일에서 확인되는 값만 보완해.
- provider, externalRef, container, 운영 URL은 추측하지 마.
- 비밀값을 파일, 명령 인자, 로그 또는 대화에 출력하지 마.
- validate에 성공한 뒤 register --draft까지만 실행해.
- 최종 승인은 하지 말고 Draft URL, 확인된 내용, 확인하지 못한 내용을 보고해줘.`;

const EXISTING_PROJECT_PROMPT = `이 저장소의 현재 기술 구성과 운영 배포 설정을 조사해서 DeployHub 등록 정보와 비교해줘.

- 작업 범위는 DeployHub 정보 갱신까지야. 실제 서비스 배포는 하지 마.
- 먼저 status와 diff를 실행해 현재 상태와 차이를 확인해.
- 필요한 변경만 deployhub.yaml에 반영하고, 확인되지 않은 값은 추측하지 마.
- 비밀값을 파일, 명령 인자, 로그 또는 대화에 출력하지 마.
- validate에 성공한 뒤 sync --draft까지만 실행해.
- 최종 승인은 하지 말고 Draft URL, 변경 요약, 확인하지 못한 내용을 보고해줘.`;
```

Also define these focused helpers in the same server file:

```tsx
function ManualToc({ className = '' }: { className?: string }) {
  return (
    <nav aria-label="매뉴얼 목차" className={className}>
      <p className="mb-3 text-sm font-semibold text-[var(--line)]">이 페이지에서</p>
      <ol className="space-y-2 text-sm">
        {TABLE_OF_CONTENTS.map((item) => (
          <li key={item.id}>
            <a href={`#${item.id}`} className="text-[var(--line-mute)] hover:text-[var(--accent)]">
              {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Section({ id, title, children }: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 border-t border-[var(--rule)] pt-8">
      <h2 className="text-2xl font-semibold text-[var(--line)]">{title}</h2>
      <div className="mt-4 space-y-4 leading-7">{children}</div>
    </section>
  );
}

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--rule)] bg-[var(--canvas)] p-4 text-sm leading-6 text-[var(--line-mute)]">
      <code>{children}</code>
    </pre>
  );
}

function CopyablePrompt({ children }: { children: string }) {
  return (
    <div>
      <CodeBlock>{children}</CodeBlock>
      <ManualCopyButton text={children} />
    </div>
  );
}
```

- [ ] **Step 4: Port the full Markdown content into the native page**

Implement `ManualPage()` with this exact outer structure:

```tsx
export default function ManualPage() {
  return (
    <>
      <Topbar title="사용 매뉴얼" />
      <main className="mx-auto w-full max-w-7xl px-4 py-8 md:px-8">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_240px]">
          <article className="min-w-0 space-y-12">
            <header>
              <p className="text-sm font-medium text-[var(--accent)]">DeployHub Guide</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--line)]">
                AI에게 DeployHub 프로젝트 등록 맡기기
              </h2>
              <p className="mt-4 max-w-3xl leading-7">
                AI는 검증된 내용을 Draft로 제출하고, 최종 반영은 사용자가 Draft 화면에서 검토·승인합니다.
              </p>
            </header>
            <ManualToc className="rounded-[var(--radius-card)] border border-[var(--rule)] bg-[var(--paper)] p-5 lg:hidden" />
            {renderManualSections()}
          </article>
          <aside className="hidden lg:block">
            <ManualToc className="lg:sticky lg:top-6 rounded-[var(--radius-card)] border border-[var(--rule)] bg-[var(--paper)] p-5" />
          </aside>
        </div>
      </main>
    </>
  );
}
```

Define `renderManualSections()` in the same file and return all eleven `Section` components in `TABLE_OF_CONTENTS` order. Port every paragraph, list, table, PowerShell/bash example, checklist, troubleshooting prompt, and completion report from `docs/ai-project-registration-manual.md` without changing its safety meaning. Apply these rules consistently:

- Render `NEW_PROJECT_PROMPT`, `EXISTING_PROJECT_PROMPT`, validate-only, re-investigation, validation-error, connection-error, and completion-report blocks with `CopyablePrompt`.
- Render commands and environment-variable examples that are not delegation prompts with `CodeBlock` only.
- Use semantic `ol`, `ul`, and checkbox-style `li` elements; do not add disabled HTML inputs.
- Wrap tables in `overflow-x-auto` and use semantic `table`, `thead`, `tbody`, `th`, and `td`.
- Link the detailed guide to `https://github.com/gnghkim/DeployHub/blob/main/docs/project-registration.md` and the AGENTS template to `https://github.com/gnghkim/DeployHub/blob/main/templates/AGENTS.deployhub.md`.
- Add this maintenance comment immediately above `ManualPage`: `// Keep this native page aligned with docs/ai-project-registration-manual.md.`
- Do not include a link to `docs/deployment.md` or instructions for deploying an application.

- [ ] **Step 5: Run the focused page and copy tests**

Run:

```powershell
pnpm exec vitest run apps/web/src/app/manual/page.test.ts apps/web/src/app/manual/manual-copy-button.test.tsx
```

Expected: both test files pass.

- [ ] **Step 6: Commit the manual page**

```powershell
git add -- apps/web/src/app/manual/page.tsx apps/web/src/app/manual/page.test.ts apps/web/src/app/manual/manual-copy-button.tsx apps/web/src/app/manual/manual-copy-button.test.tsx
git commit -m "feat: add in-app registration manual"
```

### Task 3: Add the persistent sidebar footer link

**Files:**
- Modify: `apps/web/src/components/shell/sidebar.test.ts`
- Modify: `apps/web/src/components/shell/sidebar-shell.tsx`

- [ ] **Step 1: Add failing sidebar assertions**

Add this test to `sidebar.test.ts`:

```ts
it('places the manual in the footer without changing primary navigation', () => {
  const navEnd = shellSource.indexOf('</nav>');
  const manual = shellSource.indexOf('href="/manual"');
  const systemStatus = shellSource.indexOf('System status');

  expect(manual).toBeGreaterThan(navEnd);
  expect(manual).toBeLessThan(systemStatus);
  expect(shellSource).toContain('사용 매뉴얼');
  expect(shellSource).toContain("pathname === '/manual'");
  expect(shellSource).toContain("aria-current={manualActive ? 'page' : undefined}");
  expect(shellSource).toContain('onClick={() => setOpen(false)}');
});
```

Keep the existing test named `keeps the four everyday top-level navigation items in product order` unchanged so the manual cannot accidentally enter `ACTIVE_ITEMS`.

- [ ] **Step 2: Run the sidebar test and verify the red state**

Run:

```powershell
pnpm exec vitest run apps/web/src/components/shell/sidebar.test.ts
```

Expected: the new test fails because `/manual` is absent.

- [ ] **Step 3: Implement the footer link**

In `SidebarShell`, define this value after the state declarations:

```tsx
const manualActive = pathname === '/manual';
```

Replace the existing `System status` footer with:

```tsx
<div className="mt-auto border-t border-[var(--rule)] px-3 pt-4 text-xs">
  <Link
    href="/manual"
    aria-current={manualActive ? 'page' : undefined}
    onClick={() => setOpen(false)}
    className={`block rounded-[var(--radius-button)] px-2 py-2 transition-colors ${
      manualActive
        ? 'bg-white/[0.04] text-[var(--line)]'
        : 'text-[var(--line-mute)] hover:bg-white/[0.02] hover:text-[var(--line)]'
    }`}
  >
    사용 매뉴얼
  </Link>
  <div className="px-2 pt-3 text-[var(--annotation)]">System status</div>
</div>
```

- [ ] **Step 4: Run the sidebar and manual tests**

Run:

```powershell
pnpm exec vitest run apps/web/src/components/shell/sidebar.test.ts apps/web/src/app/manual/page.test.ts apps/web/src/app/manual/manual-copy-button.test.tsx
```

Expected: all three test files pass.

- [ ] **Step 5: Commit the sidebar integration**

```powershell
git add -- apps/web/src/components/shell/sidebar-shell.tsx apps/web/src/components/shell/sidebar.test.ts
git commit -m "feat: link manual from sidebar"
```

### Task 4: Run full web verification and inspect the page in a browser

**Files:**
- Verify: `apps/web/src/app/manual/page.tsx`
- Verify: `apps/web/src/app/manual/manual-copy-button.tsx`
- Verify: `apps/web/src/components/shell/sidebar-shell.tsx`

- [ ] **Step 1: Run the complete web test project**

Run:

```powershell
pnpm exec vitest run --project web
```

Expected: all web test files pass. Database-backed files require Docker; if the environment lacks a container runtime, record that baseline limitation and still require the three focused manual/sidebar test files to pass.

- [ ] **Step 2: Run type checking**

Run:

```powershell
pnpm --filter web typecheck
```

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 3: Build the production web bundle**

Run:

```powershell
pnpm --filter web build
```

Expected: Next.js build exits 0 and lists `/manual` as a route.

- [ ] **Step 4: Run formatting and scope checks**

Run:

```powershell
git diff --check
git status --short
git diff --stat main...HEAD
```

Expected: no whitespace errors; only the planned page, copy button, sidebar, and test files differ from the base branch. The user-owned `.superpowers/` directory remains untouched.

- [ ] **Step 5: Verify the user flow in a browser**

Start the verified web application with its normal local environment, sign in, and verify:

1. Desktop sidebar shows `사용 매뉴얼` below the primary navigation and above `System status`.
2. `/manual` displays every section and the desktop sticky table of contents.
3. A table-of-contents link moves focus/scroll to its matching section.
4. `요청문 복사` copies the entire prompt and shows `복사됨`.
5. At a mobile viewport, the sidebar link appears in the drawer, the inline table of contents is visible, and long code blocks scroll horizontally.

Expected: all five checks pass without console errors.

### Task 5: Merge, push, deploy, and verify production

**Files:**
- No new source files.
- Reference: `docs/deployment.md` `운영 메모 → 재배포`.

- [ ] **Step 1: Complete the feature branch workflow**

Use `superpowers:finishing-a-development-branch`, merge the verified branch into `main`, and rerun the focused tests and type check on the merged result.

- [ ] **Step 2: Push main**

Run:

```powershell
git push origin main
```

Expected: `origin/main` advances to the in-app manual commit and `git rev-list --count origin/main..main` prints `0`.

- [ ] **Step 3: Deploy through the confirmed production account and path**

Use the confirmed key and deployment path without printing secrets:

```powershell
ssh -i "$env:USERPROFILE\.ssh\linkvault_hostinger" -o IdentitiesOnly=yes -o BatchMode=yes dev@187.127.204.154 "cd /home/dev/DeployHub && git pull --ff-only && docker compose --env-file .env -f docker/compose.yml build && docker compose --env-file .env -f docker/compose.yml --profile tools build migrate && docker compose --env-file .env -f docker/compose.yml --profile tools run --rm migrate && docker compose --env-file .env -f docker/compose.yml up -d"
```

Expected: build, migration, and Compose startup all exit 0.

- [ ] **Step 4: Verify production containers and route**

On the server, verify the deployed commit equals `origin/main`, the repository is clean, all five DeployHub containers are running, PostgreSQL and snapshotter are healthy, and worker logs show no failed jobs. From the local machine, verify:

```powershell
curl.exe -sS -o NUL -w "%{http_code}`n" https://hub.nolzza.net/manual
```

Expected: unauthenticated access returns the normal authentication redirect (`307`). After signing in through the browser, `/manual` renders the full page and prompt copy succeeds.
