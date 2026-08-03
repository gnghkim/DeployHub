# Self-contained DeployHub Manual Prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each copied DeployHub delegation prompt tell an AI exactly how to run the public CLI without web searching, global installation, secret exposure, unrelated edits, or duplicate Draft submissions.

**Architecture:** Keep the existing static server page and Markdown manual. Strengthen the two prompt strings in both sources, and extend the existing source-level test so it verifies the requirements inside each prompt rather than merely elsewhere on the page.

**Tech Stack:** Next.js App Router, React, TypeScript, Vitest, Markdown, pnpm

---

## File map

- `apps/web/src/app/manual/page.tsx`: owns the two strings copied by the in-app manual's prompt buttons.
- `docs/ai-project-registration-manual.md`: owns the repository-readable version of the same two prompts.
- `apps/web/src/app/manual/page.test.ts`: verifies both prompt sources stay self-contained and synchronized in meaning.

### Task 1: Add a failing self-contained-prompt regression test

**Files:**
- Modify: `apps/web/src/app/manual/page.test.ts`

- [ ] **Step 1: Add prompt-section extraction and the new assertions**

Add this helper after the `sections` constant:

```ts
function sliceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}
```

Add this test inside `describe('in-app manual page', ...)`:

```ts
it('makes both copied prompts self-contained and avoids CLI discovery detours', () => {
  const promptPairs = [
    {
      pagePrompt: sliceBetween(
        page,
        'const NEW_PROJECT_PROMPT',
        'const EXISTING_PROJECT_PROMPT',
      ),
      markdownPrompt: sliceBetween(
        markdown,
        '## 신규 프로젝트 등록 맡기기',
        '## 기존 프로젝트 정보 갱신 맡기기',
      ),
      commands: [
        'npx @deployhub/cli init --detect',
        'npx @deployhub/cli validate',
        'npx @deployhub/cli register --draft',
      ],
    },
    {
      pagePrompt: sliceBetween(
        page,
        'const EXISTING_PROJECT_PROMPT',
        'const REINVESTIGATE_PROMPT',
      ),
      markdownPrompt: sliceBetween(
        markdown,
        '## 기존 프로젝트 정보 갱신 맡기기',
        '## AI가 따라야 하는 절차',
      ),
      commands: [
        'npx @deployhub/cli status',
        'npx @deployhub/cli diff',
        'npx @deployhub/cli validate',
        'npx @deployhub/cli sync --draft',
      ],
    },
  ] as const;

  for (const { pagePrompt, markdownPrompt, commands } of promptPairs) {
    for (const prompt of [pagePrompt, markdownPrompt]) {
      for (const command of commands) {
        expect(prompt).toContain(command);
      }
      expect(prompt).toContain('웹에서 검색하지 마');
      expect(prompt).toContain('전역 설치하지 마');
      expect(prompt).toContain('현재 터미널 환경변수만 사용');
      expect(prompt).toContain('기존 작업 파일을 수정하거나 커밋하지 마');
      expect(prompt).toContain('자동으로 재시도하지 마');
    }
  }
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
pnpm exec vitest run apps/web/src/app/manual/page.test.ts
```

Expected: FAIL because the current copied prompts do not contain the full `npx @deployhub/cli` sequences or the detour-prevention wording.

### Task 2: Make both prompt sources self-contained

**Files:**
- Modify: `apps/web/src/app/manual/page.tsx`
- Modify: `docs/ai-project-registration-manual.md`
- Test: `apps/web/src/app/manual/page.test.ts`

- [ ] **Step 1: Replace the in-app new-project prompt**

Replace `NEW_PROJECT_PROMPT` with:

```ts
const NEW_PROJECT_PROMPT = `이 저장소의 실제 기술 구성과 운영 배포 설정을 조사해서 DeployHub 신규 등록을 준비해줘.

- 작업 범위는 DeployHub 프로젝트 등록까지야. 실제 서비스 배포는 하지 마.
- 전역 deployhub 명령을 찾거나 CLI 사용법을 웹에서 검색하지 마. CLI를 전역 설치하지 마.
- 등록 대상 저장소 루트에서 아래 명령을 순서대로 실행해.
  npx @deployhub/cli init --detect
- CLI가 출력한 INFERRED FIELDS와 UNKNOWN FIELDS를 검토하고, 파일에서 확인되는 값만 deployhub.yaml에 보완해.
- provider, externalRef, container, 운영 URL은 추측하지 마.
- DEPLOYHUB_URL과 DEPLOYHUB_TOKEN은 현재 터미널 환경변수만 사용하고 값을 출력하지 마.
- 등록과 무관한 기존 작업 파일을 수정하거나 커밋하지 마.
- manifest를 보완한 뒤 아래 명령으로 검증해.
  npx @deployhub/cli validate
- validate에 성공한 경우에만 아래 Draft 제출 명령을 한 번 실행해.
  npx @deployhub/cli register --draft
- 제출에 실패하거나 결과가 불확실하면 자동으로 재시도하지 마.
- 최종 승인은 하지 말고 Draft URL, 확인된 내용, 확인하지 못한 내용을 보고해줘.`;
```

- [ ] **Step 2: Replace the in-app existing-project prompt**

Replace `EXISTING_PROJECT_PROMPT` with:

```ts
const EXISTING_PROJECT_PROMPT = `이 저장소의 현재 기술 구성과 운영 배포 설정을 조사해서 DeployHub 등록 정보와 비교해줘.

- 작업 범위는 DeployHub 정보 갱신까지야. 실제 서비스 배포는 하지 마.
- 전역 deployhub 명령을 찾거나 CLI 사용법을 웹에서 검색하지 마. CLI를 전역 설치하지 마.
- DEPLOYHUB_URL과 DEPLOYHUB_TOKEN은 현재 터미널 환경변수만 사용하고 값을 출력하지 마.
- 등록과 무관한 기존 작업 파일을 수정하거나 커밋하지 마.
- 등록 대상 저장소 루트에서 아래 명령을 순서대로 실행해 현재 상태와 차이를 확인해.
  npx @deployhub/cli status
  npx @deployhub/cli diff
- 필요한 변경만 deployhub.yaml에 반영하고, provider, externalRef, container, 운영 URL은 추측하지 마.
- 차이가 없으면 Draft를 만들지 말고 변경 없음으로 보고해.
- 변경이 있으면 아래 명령으로 검증해.
  npx @deployhub/cli validate
- validate에 성공한 경우에만 아래 Draft 제출 명령을 한 번 실행해.
  npx @deployhub/cli sync --draft
- 제출에 실패하거나 결과가 불확실하면 자동으로 재시도하지 마.
- 최종 승인은 하지 말고 Draft URL, 변경 요약, 확인하지 못한 내용을 보고해줘.`;
```

- [ ] **Step 3: Apply the same wording to the Markdown manual**

In `docs/ai-project-registration-manual.md`, replace the fenced `text` block under `신규 프로젝트 등록 맡기기` with the body of `NEW_PROJECT_PROMPT`, and replace the fenced `text` block under `기존 프로젝트 정보 갱신 맡기기` with the body of `EXISTING_PROJECT_PROMPT`. Preserve the surrounding headings and explanatory prose.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
pnpm exec vitest run apps/web/src/app/manual/page.test.ts
```

Expected: 1 test file passes with 5 tests.

- [ ] **Step 5: Run related regressions**

Run:

```powershell
pnpm exec vitest run apps/web/src/app/manual/page.test.ts apps/web/src/app/manual/manual-copy-button.test.tsx apps/web/src/components/shell/sidebar.test.ts
```

Expected: 3 test files pass with 17 tests.

- [ ] **Step 6: Commit the behavior change**

```powershell
git add -- apps/web/src/app/manual/page.test.ts apps/web/src/app/manual/page.tsx docs/ai-project-registration-manual.md
git commit -m "docs: make manual prompts self-contained"
```

### Task 3: Verify the finished change

**Files:**
- Verify: `apps/web/src/app/manual/page.tsx`
- Verify: `docs/ai-project-registration-manual.md`
- Verify: `apps/web/src/app/manual/page.test.ts`

- [ ] **Step 1: Run TypeScript validation**

Run:

```powershell
pnpm --filter web typecheck
```

Expected: exit code 0.

- [ ] **Step 2: Run the production build**

Run:

```powershell
pnpm --filter web build
```

Expected: exit code 0 and `/manual` appears in the Next.js route list.

- [ ] **Step 3: Check patch hygiene and repository scope**

Run:

```powershell
git diff --check main...HEAD
git status --short
git diff --stat main...HEAD
```

Expected: no whitespace errors; the branch contains only the design, implementation plan, prompt test, in-app prompt, and Markdown prompt changes. Build output remains ignored.
