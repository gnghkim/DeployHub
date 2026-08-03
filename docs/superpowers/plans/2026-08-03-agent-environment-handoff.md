# Agent Environment Handoff Manual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach users how to pass DeployHub environment variables safely into a newly started Orca/AI process, recover an existing session without exposing the token, and remove the persisted token after Draft submission.

**Architecture:** Keep the manual as a database-free server page backed by matching Markdown. Add one static recovery prompt, expand the environment setup content in both sources, and extend source-level tests so all security and process-boundary instructions remain synchronized.

**Tech Stack:** Next.js App Router, React, TypeScript, Vitest, Markdown, PowerShell 7, pnpm

---

## File map

- `apps/web/src/app/manual/page.tsx`: renders quick-start, setup, recovery, cleanup and incident-response guidance; owns the copyable recovery prompt.
- `docs/ai-project-registration-manual.md`: repository-readable equivalent of the in-app guidance.
- `apps/web/src/app/manual/page.test.ts`: verifies both manual surfaces contain the approved process and secret-handling rules.

### Task 1: Add failing process-boundary and token-safety tests

**Files:**
- Modify: `apps/web/src/app/manual/page.test.ts`

- [ ] **Step 1: Add a regression test for both manual surfaces**

Add this test inside `describe('in-app manual page', ...)`:

```ts
it('documents safe environment handoff, recovery, and cleanup', () => {
  const requiredGuidance = [
    "Read-Host 'DEPLOYHUB_TOKEN' -AsSecureString",
    "SetEnvironmentVariable('DEPLOYHUB_TOKEN', $plainToken, 'User')",
    '이미 실행 중인 Orca/AI',
    '완전히 종료하고 새로 시작',
    'DEPLOYHUB_URL_PRESENT=$urlPresent',
    'DEPLOYHUB_TOKEN_PRESENT=$tokenPresent',
    '값, 길이, 접두사 또는 일부 문자열',
    '동일한 PowerShell 호출',
    "SetEnvironmentVariable('DEPLOYHUB_TOKEN', $null, 'User')",
    '즉시 폐기하고 새 토큰을 발급',
  ];

  for (const source of [page, markdown]) {
    for (const guidance of requiredGuidance) {
      expect(source).toContain(guidance);
    }
  }

  expect(page).toContain('const ENVIRONMENT_RECOVERY_PROMPT');
  expect(page).toContain(
    '<CopyablePrompt>{ENVIRONMENT_RECOVERY_PROMPT}</CopyablePrompt>',
  );
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
pnpm exec vitest run apps/web/src/app/manual/page.test.ts
```

Expected: FAIL because the current manual does not explain process restart, User-scope cleanup, Boolean-only checks, or the recovery prompt.

### Task 2: Add the existing-session recovery prompt

**Files:**
- Modify: `apps/web/src/app/manual/page.tsx`
- Modify: `docs/ai-project-registration-manual.md`
- Test: `apps/web/src/app/manual/page.test.ts`

- [ ] **Step 1: Define the recovery prompt in the in-app page**

Add this constant after `CONNECTION_ERROR_PROMPT`:

```ts
const ENVIRONMENT_RECOVERY_PROMPT = `현재 AI 세션에서 DEPLOYHUB_URL과 DEPLOYHUB_TOKEN이 보이지 않는 문제만 안전하게 복구해줘.

- 토큰을 대화로 요구하지 말고 값, 길이, 접두사 또는 일부 문자열을 출력하지 마.
- 현재 PowerShell 프로세스의 값이 비어 있을 때만 User 범위 환경변수에서 읽어 $env:DEPLOYHUB_URL과 $env:DEPLOYHUB_TOKEN에 복사해.
- 각 npx @deployhub/cli 명령을 실행하는 동일한 PowerShell 호출 안에서 환경변수를 불러와. 다음 도구 호출까지 유지된다고 가정하지 마.
- 확인 결과는 DEPLOYHUB_URL_PRESENT와 DEPLOYHUB_TOKEN_PRESENT의 True/False만 보고해.
- User 범위에도 값이 없으면 CLI와 Draft 제출을 실행하지 말고 Orca/AI를 완전히 종료하고 새로 시작해야 한다고 보고해.
- Draft 제출에 실패했거나 결과가 불확실하면 자동으로 재시도하지 마.`;
```

- [ ] **Step 2: Render the recovery prompt in troubleshooting**

In the `troubleshooting` section, insert this block before the 401/403 subsection:

```tsx
<Subheading>환경변수가 AI 세션에서 보이지 않을 때</Subheading>
<CopyablePrompt>{ENVIRONMENT_RECOVERY_PROMPT}</CopyablePrompt>
```

- [ ] **Step 3: Add the matching Markdown subsection**

Before `### 401, 403 또는 서버 연결 오류 진단하기`, add:

````markdown
### 환경변수가 AI 세션에서 보이지 않을 때

이미 실행 중인 AI 세션을 계속 사용해야 할 때만 아래 요청문을 사용합니다.

```text
현재 AI 세션에서 DEPLOYHUB_URL과 DEPLOYHUB_TOKEN이 보이지 않는 문제만 안전하게 복구해줘.

- 토큰을 대화로 요구하지 말고 값, 길이, 접두사 또는 일부 문자열을 출력하지 마.
- 현재 PowerShell 프로세스의 값이 비어 있을 때만 User 범위 환경변수에서 읽어 $env:DEPLOYHUB_URL과 $env:DEPLOYHUB_TOKEN에 복사해.
- 각 npx @deployhub/cli 명령을 실행하는 동일한 PowerShell 호출 안에서 환경변수를 불러와. 다음 도구 호출까지 유지된다고 가정하지 마.
- 확인 결과는 DEPLOYHUB_URL_PRESENT와 DEPLOYHUB_TOKEN_PRESENT의 True/False만 보고해.
- User 범위에도 값이 없으면 CLI와 Draft 제출을 실행하지 말고 Orca/AI를 완전히 종료하고 새로 시작해야 한다고 보고해.
- Draft 제출에 실패했거나 결과가 불확실하면 자동으로 재시도하지 마.
```
````

### Task 3: Replace the PowerShell setup with explicit process handoff

**Files:**
- Modify: `apps/web/src/app/manual/page.tsx`
- Modify: `docs/ai-project-registration-manual.md`
- Test: `apps/web/src/app/manual/page.test.ts`

- [ ] **Step 1: Update quick-start wording in both sources**

State that Windows users store the variables before opening the AI session, completely close and restart an already-running Orca/AI process, then open the target repository in the new session. Keep the existing Draft review steps unchanged.

- [ ] **Step 2: Replace the in-app PowerShell setup block**

Use this code in the `PowerShell 7` code block:

```powershell
[Environment]::SetEnvironmentVariable(
  'DEPLOYHUB_URL',
  'https://deployhub.example.com',
  'User'
)

$secureToken = Read-Host 'DEPLOYHUB_TOKEN' -AsSecureString
$plainToken = [Net.NetworkCredential]::new('', $secureToken).Password
[Environment]::SetEnvironmentVariable('DEPLOYHUB_TOKEN', $plainToken, 'User')
Remove-Variable secureToken, plainToken
```

Immediately after it, explain that User-scope values are temporary handoff data readable by processes under the same user account. Tell the user to completely close and restart Orca/AI because existing processes do not receive later environment changes.

- [ ] **Step 3: Add the in-app Boolean-only check**

Add the following `PowerShell 7 — 새 AI 세션에서 존재 여부만 확인` block:

```powershell
$urlPresent = -not [string]::IsNullOrWhiteSpace($env:DEPLOYHUB_URL)
$tokenPresent = -not [string]::IsNullOrWhiteSpace($env:DEPLOYHUB_TOKEN)
"DEPLOYHUB_URL_PRESENT=$urlPresent"
"DEPLOYHUB_TOKEN_PRESENT=$tokenPresent"
```

Explain that values, lengths, prefixes, and partial strings must never be printed, and no CLI submission runs when either value is `False`.

- [ ] **Step 4: Add the in-app cleanup block**

Add `Draft 제출 후 PowerShell User 범위 토큰 제거` with:

```powershell
[Environment]::SetEnvironmentVariable('DEPLOYHUB_TOKEN', $null, 'User')
Remove-Item Env:DEPLOYHUB_TOKEN -ErrorAction SilentlyContinue
```

Explain that inherited copies can remain in other running processes, so the AI/terminal process used for registration must also exit.

- [ ] **Step 5: Mirror the setup, check, and cleanup in Markdown**

Replace the current PowerShell block and surrounding explanation in `docs/ai-project-registration-manual.md` with the same commands and the same process-boundary guidance from Steps 2–4. Preserve the existing macOS/Linux commands, adding one sentence that their variables are also process-scoped and the AI must be started from that environment or restarted through its host application.

- [ ] **Step 6: Strengthen incident response in both sources**

Use this rule in the secret-information section:

```text
토큰 전체나 일부가 터미널 출력, 로그, AI 대화, 스크린샷 또는 화면 공유에 나타나면 해당 토큰을 즉시 폐기하고 새 토큰을 발급합니다. 노출된 토큰은 다시 사용하지 않습니다.
```

### Task 4: Verify GREEN and commit

**Files:**
- Modify: `apps/web/src/app/manual/page.test.ts`
- Modify: `apps/web/src/app/manual/page.tsx`
- Modify: `docs/ai-project-registration-manual.md`

- [ ] **Step 1: Run the focused test**

Run:

```powershell
pnpm exec vitest run apps/web/src/app/manual/page.test.ts
```

Expected: 1 file passes with 6 tests.

- [ ] **Step 2: Run related regressions**

Run:

```powershell
pnpm exec vitest run apps/web/src/app/manual/page.test.ts apps/web/src/app/manual/manual-copy-button.test.tsx apps/web/src/components/shell/sidebar.test.ts
```

Expected: 3 files pass with 18 tests.

- [ ] **Step 3: Commit the manual update**

```powershell
git add -- apps/web/src/app/manual/page.test.ts apps/web/src/app/manual/page.tsx docs/ai-project-registration-manual.md
git commit -m "docs: explain AI environment handoff"
```

### Task 5: Final verification

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

- [ ] **Step 3: Check patch hygiene and scope**

Run:

```powershell
git diff --check main...HEAD
git status --short
git diff --stat main...HEAD
```

Expected: no whitespace errors; only the design, plan, manual test, in-app manual, and Markdown manual are changed. Build output stays ignored.
