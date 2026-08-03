# AI Project Registration Manual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a Korean user manual that lets users safely delegate another project's DeployHub registration or information update to an AI agent.

**Architecture:** Add one task-oriented manual that starts with copyable prompts and separates the user's approval duties from the AI's investigation and Draft-submission duties. Keep `docs/project-registration.md` as the detailed CLI reference, and add one discoverability link to the README documentation table.

**Tech Stack:** Markdown, DeployHub CLI (`npx @deployhub/cli`), PowerShell verification, Git

---

## File structure

- Create `docs/ai-project-registration-manual.md`: user-facing quick start, delegation prompts, approval checklist, safety rules, troubleshooting prompts, and completion-report example.
- Modify `README.md`: add the new manual to the existing `상세 문서` table.
- Reference without modifying `docs/project-registration.md`: authoritative details for tokens, manifest fields, Draft behavior, and errors.
- Reference without modifying `templates/AGENTS.deployhub.md`: reusable target-repository instructions for AI agents.

### Task 1: Create the AI delegation manual

**Files:**
- Create: `docs/ai-project-registration-manual.md`
- Reference: `docs/superpowers/specs/2026-08-03-ai-project-registration-manual-design.md`
- Reference: `docs/project-registration.md`
- Reference: `templates/AGENTS.deployhub.md`

- [ ] **Step 1: Verify the authoritative command sequences before drafting**

Run:

```powershell
rg -n "신규 프로젝트:|기존 프로젝트:|npx @deployhub/cli|DEPLOYHUB_TOKEN|Draft URL" templates/AGENTS.deployhub.md docs/project-registration.md
```

Expected: output shows `init --detect → validate → register --draft` for a new project and `status → diff → validate → sync --draft` for an existing project, plus environment-only token handling and human Draft approval.

- [ ] **Step 2: Create the manual with the approved task-oriented structure**

Create `docs/ai-project-registration-manual.md` with these exact top-level sections, in this order:

```markdown
# AI에게 DeployHub 프로젝트 등록 맡기기

## 이 매뉴얼의 범위
## 5분 빠른 시작
## 시작 전에 준비할 것
## 신규 프로젝트 등록 맡기기
## 기존 프로젝트 정보 갱신 맡기기
## AI가 따라야 하는 절차
## Draft에서 사용자가 확인할 것
## 비밀정보와 추측 방지 원칙
## 문제가 생겼을 때 다시 요청하기
## AI의 완료 보고 예시
## 더 자세한 문서
```

The introduction must explicitly state all three boundaries:

```markdown
이 문서는 **다른 프로젝트를 DeployHub에 등록하거나 등록 정보를 갱신하는 작업**을
AI에게 맡기는 방법을 설명합니다. 대상 프로젝트의 실제 서비스 배포와 DeployHub
자체 서비스의 배포는 다루지 않습니다. AI는 검증된 내용을 Draft로 제출하고,
최종 반영은 사용자가 Draft 화면에서 검토·승인합니다.
```

Under `5분 빠른 시작`, tell the user to open the target repository, prepare terminal environment variables without pasting secret values into chat, copy the appropriate prompt, and approve only after reviewing the Draft URL.

Under `시작 전에 준비할 것`, include:

- Node.js 22 or newer.
- The target repository opened as the AI's working directory.
- `DEPLOYHUB_URL` and `DEPLOYHUB_TOKEN` set in the terminal environment.
- A warning that the token value must not appear in chat, files, command arguments, or logs.
- A recommendation to merge `templates/AGENTS.deployhub.md` into an existing target-repository instruction file without overwriting that file.

Include this exact new-project prompt in a fenced `text` block:

```text
이 저장소의 실제 기술 구성과 운영 배포 설정을 조사해서 DeployHub 신규 등록을 준비해줘.

- 작업 범위는 DeployHub 프로젝트 등록까지야. 실제 서비스 배포는 하지 마.
- 저장소 루트에서 DeployHub CLI를 사용해 deployhub.yaml을 생성해.
- CLI가 출력한 INFERRED FIELDS와 UNKNOWN FIELDS를 검토하고, 파일에서 확인되는 값만 보완해.
- provider, externalRef, container, 운영 URL은 추측하지 마.
- 비밀값을 파일, 명령 인자, 로그 또는 대화에 출력하지 마.
- validate에 성공한 뒤 register --draft까지만 실행해.
- 최종 승인은 하지 말고 Draft URL, 확인된 내용, 확인하지 못한 내용을 보고해줘.
```

Include this exact existing-project prompt in a fenced `text` block:

```text
이 저장소의 현재 기술 구성과 운영 배포 설정을 조사해서 DeployHub 등록 정보와 비교해줘.

- 작업 범위는 DeployHub 정보 갱신까지야. 실제 서비스 배포는 하지 마.
- 먼저 status와 diff를 실행해 현재 상태와 차이를 확인해.
- 필요한 변경만 deployhub.yaml에 반영하고, 확인되지 않은 값은 추측하지 마.
- 비밀값을 파일, 명령 인자, 로그 또는 대화에 출력하지 마.
- validate에 성공한 뒤 sync --draft까지만 실행해.
- 최종 승인은 하지 말고 Draft URL, 변경 요약, 확인하지 못한 내용을 보고해줘.
```

Under `AI가 따라야 하는 절차`, show these command sequences without adding an approval command:

```text
신규: npx @deployhub/cli init --detect
      npx @deployhub/cli validate
      npx @deployhub/cli register --draft

기존: npx @deployhub/cli status
      npx @deployhub/cli diff
      npx @deployhub/cli validate
      npx @deployhub/cli sync --draft
```

Explain that the AI may edit `deployhub.yaml` between detection/diff and validation, but only with evidence from the repository or confirmed operating configuration. State the token requirement accurately: `init` and `validate` do not require it; `status`, `diff`, `register --draft`, and `sync --draft` do.

Under `Draft에서 사용자가 확인할 것`, include a checklist for project name/slug, repository, components, provider, `externalRef`, container, production HTTP(S) URL, deletions/unexpected changes, validation result, and the AI's unresolved-items report.

Under `비밀정보와 추측 방지 원칙`, distinguish safe environment-variable setup from unsafe chat/file/argument/log exposure. Explicitly prohibit inventing YAML structure, provider, external reference, container name, or URL.

Under `문제가 생겼을 때 다시 요청하기`, include copyable prompts for these cases:

1. Validate only, without Draft submission.
2. Re-investigate missing or apparently guessed values.
3. Diagnose a validation error without submitting a failed manifest.
4. Diagnose 401, 403, or connection failures without revealing the token.

Each prompt must state whether Draft submission is allowed. Link detailed error descriptions to `./project-registration.md#10-문제-해결`.

Under `AI의 완료 보고 예시`, show a report containing:

- Result: Draft submitted or not submitted.
- Validation result.
- Draft URL only when submission succeeded.
- Confirmed changes.
- Unconfirmed/omitted fields.
- Exact items the user should review.

Under `더 자세한 문서`, link:

- `[프로젝트 등록 상세 가이드](./project-registration.md)`
- `[다른 저장소용 AGENTS 템플릿](../templates/AGENTS.deployhub.md)`

Do not link the production deployment runbook from this task-specific manual because deployment is explicitly outside its scope.

- [ ] **Step 3: Run content and safety checks**

Run:

```powershell
$manual = Get-Content -Raw -Encoding UTF8 docs/ai-project-registration-manual.md
$required = @(
  '# AI에게 DeployHub 프로젝트 등록 맡기기',
  '실제 서비스 배포는 하지 마',
  'init --detect',
  'register --draft',
  'status',
  'diff',
  'sync --draft',
  'DEPLOYHUB_TOKEN',
  'Draft URL',
  './project-registration.md#10-문제-해결',
  '../templates/AGENTS.deployhub.md'
)
$missing = $required | Where-Object { -not $manual.Contains($_) }
if ($missing.Count -gt 0) {
  Write-Error ('Missing manual content: ' + ($missing -join ', '))
  exit 1
}
if ($manual -match 'DEPLOYHUB_TOKEN\s*=\s*[^<\s`]+') {
  Write-Error 'The manual appears to contain a concrete token value.'
  exit 1
}
git diff --check -- docs/ai-project-registration-manual.md
```

Expected: exit code 0, no missing-content error, no concrete-token error, and no whitespace errors.

- [ ] **Step 4: Commit the manual**

```powershell
git add -- docs/ai-project-registration-manual.md
git commit -m "docs: add AI project registration manual"
```

Expected: one commit containing only the new manual.

### Task 2: Link the manual from README and verify the documentation set

**Files:**
- Modify: `README.md:146`
- Verify: `docs/ai-project-registration-manual.md`

- [ ] **Step 1: Confirm the README does not already contain the manual link**

Run:

```powershell
if (Select-String -Quiet -Path README.md -SimpleMatch './docs/ai-project-registration-manual.md') {
  Write-Error 'README already contains the manual link; inspect before editing.'
  exit 1
}
```

Expected: exit code 0 because the new link is not present yet.

- [ ] **Step 2: Add the manual to the detailed-document table**

Insert this row immediately before the existing `프로젝트 등록 가이드` row:

```markdown
| [AI 프로젝트 등록 위임 매뉴얼](./docs/ai-project-registration-manual.md) | AI에게 신규 등록·정보 갱신을 맡기는 요청문과 Draft 검토 절차 |
```

Keep the detailed registration guide and AGENTS template rows unchanged.

- [ ] **Step 3: Verify links, command coverage, scope, and formatting**

Run:

```powershell
$manualPath = 'docs/ai-project-registration-manual.md'
$readme = Get-Content -Raw -Encoding UTF8 README.md
$manual = Get-Content -Raw -Encoding UTF8 $manualPath

if (-not $readme.Contains('./docs/ai-project-registration-manual.md')) {
  Write-Error 'README manual link is missing.'
  exit 1
}

$relativeLinks = [regex]::Matches($manual, '\]\((\.{1,2}/[^)#]+)(?:#[^)]+)?\)')
foreach ($match in $relativeLinks) {
  $target = Join-Path (Split-Path $manualPath) $match.Groups[1].Value
  if (-not (Test-Path $target)) {
    Write-Error "Broken relative link: $($match.Groups[1].Value)"
    exit 1
  }
}

$requiredCommands = @(
  'init --detect',
  'validate',
  'register --draft',
  'status',
  'diff',
  'sync --draft'
)
foreach ($command in $requiredCommands) {
  if (-not $manual.Contains($command)) {
    Write-Error "Missing command: $command"
    exit 1
  }
}

if (-not $manual.Contains('DeployHub 자체 서비스의 배포는 다루지 않습니다')) {
  Write-Error 'DeployHub self-deployment exclusion is missing.'
  exit 1
}

git diff --check
```

Expected: exit code 0, all relative links resolve, all six CLI operations appear, the scope exclusion appears, and Git reports no whitespace errors.

- [ ] **Step 4: Review the final diff for accidental changes**

Run:

```powershell
git status --short
git diff -- README.md docs/ai-project-registration-manual.md
```

Expected: only `README.md` is uncommitted at this point; the unrelated user-owned `.superpowers/` directory remains untouched and untracked.

- [ ] **Step 5: Commit the README link**

```powershell
git add -- README.md
git commit -m "docs: link AI registration manual"
```

Expected: one commit containing only the README documentation-table change.

- [ ] **Step 6: Verify the final repository state**

Run:

```powershell
git log -2 --oneline
git status --short
```

Expected: the two new documentation commits are at the top of the log; no tracked changes remain, and the pre-existing untracked `.superpowers/` directory is still present and untouched.
