# DeployHub README Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sparse README with an operator-first Korean guide that accurately introduces DeployHub, explains its components, provides verified development and validation commands, and routes detailed operations to the existing documentation.

**Architecture:** Keep `README.md` as the single repository landing page and treat the existing documents under `docs/` as authoritative runbooks. The README will contain only verified commands and high-level workflows; it will not duplicate production deployment, manifest field, Draft approval, or npm publishing procedures.

**Tech Stack:** Markdown, Node.js 22, pnpm 9 workspaces, Next.js 16, PostgreSQL 17, Docker Compose, Vitest, DeployHub CLI

---

## File map

- Modify: `README.md` — operator-first project overview, architecture, quick start, validation, CLI workflow, documentation index, fixed versions, and license.
- Reference only: `package.json`, `apps/web/package.json`, `apps/worker/package.json`, `packages/cli/package.json` — command and package-name sources.
- Reference only: `.env.example`, `docker/compose.yml`, `deployhub.yaml` — environment and runtime-component sources.
- Reference only: `docs/deployment.md`, `docs/project-registration.md`, `docs/cli-npm-publishing.md`, `templates/AGENTS.deployhub.md` — detailed procedure targets.

### Task 1: Replace README with the operator-first guide

**Files:**
- Modify: `README.md`
- Test: inline Node.js documentation contract

- [ ] **Step 1: Run the documentation contract against the current README**

Run from the repository root:

```powershell
@'
const fs = require('node:fs');
const text = fs.readFileSync('README.md', 'utf8');
const required = [
  '## 주요 기능',
  '## 시스템 구성',
  '## 개발 및 검증 빠른 시작',
  '## DeployHub CLI',
  '## 상세 문서',
  '## 확정 버전',
  '## 라이선스',
];
const missing = required.filter((heading) => !text.includes(heading));
if (missing.length > 0) {
  console.error(`Missing README sections: ${missing.join(', ')}`);
  process.exit(1);
}
'@ | node
```

Expected: FAIL with at least `## 주요 기능` in `Missing README sections`.

- [ ] **Step 2: Replace `README.md` with the approved content**

Use this complete content:

````markdown
# DeployHub

DeployHub는 여러 프로젝트의 애플리케이션, 인프라, 도메인, 배포 이력과 상태를
한곳에서 관리하는 통합 프로젝트·인프라 관리 시스템이다. 저장소에서 감지한
manifest는 바로 운영 정보에 반영하지 않고 Draft로 제출한 뒤 사람이 검토하고
승인한다.

## 주요 기능

- 프로젝트별 애플리케이션·데이터베이스·인프라 구성요소를 한 화면에서 확인한다.
- HTTP 상태 점검과 Docker 컨테이너 상태를 수집해 장애 여부를 표시한다.
- 최근 배포 상태와 시각을 프로젝트·구성요소와 연결해 보여 준다.
- 프로젝트 카드를 이름 단위로 접어 필요한 프로젝트만 자세히 볼 수 있으며, 접힘
  상태는 브라우저에 프로젝트별로 유지된다.
- CLI가 저장소를 감지해 `deployhub.yaml` 초안을 만들고 Schema로 검증한다.
- 신규 등록과 변경 사항을 Draft로 제출해 사람의 승인 후 반영한다.
- GitHub OAuth와 허용 사용자 목록으로 관리 화면 접근을 제한한다.

## 시스템 구성

| 구성요소 | 역할 |
| --- | --- |
| `apps/web` | Next.js 기반 관리 화면, 인증, API와 Draft 검토 화면 |
| `apps/worker` | 상태 점검, Docker 정보 동기화와 백그라운드 작업 처리 |
| PostgreSQL | 프로젝트, 구성요소, 상태, 배포와 Draft 데이터 저장 |
| Docker Socket Proxy | 워커에 제한된 Docker 조회 API만 제공 |
| `@deployhub/cli` | 저장소 감지, manifest 검증, 상태·차이 조회와 Draft 제출 |

저장소는 pnpm workspace 모노레포이며, 공통 데이터베이스·수집기·manifest·공유
코드는 `packages/` 아래에 있다. 운영 환경에서는 Docker Compose로 웹, 워커,
PostgreSQL과 Socket Proxy를 실행하고 Caddy가 HTTPS 요청을 웹 컨테이너로
전달한다.

## 요구사항

- Node.js 22 이상
- pnpm 9.15.0
- 전체 서비스나 PostgreSQL을 컨테이너로 실행할 경우 Docker와 Docker Compose

운영용 Compose 구성은 PostgreSQL 포트를 호스트에 공개하지 않고 공용 Caddy
네트워크를 전제로 한다. 실제 서비스를 실행하려면 먼저
[배포 가이드](./docs/deployment.md)의 환경변수와 네트워크 구성을 따른다.

## 개발 및 검증 빠른 시작

저장소 루트에서 의존성을 설치한다.

```bash
pnpm install --frozen-lockfile
```

환경변수 이름과 용도는 [`.env.example`](./.env.example)에서 확인한다. 필요한
값은 비밀값 관리 도구나 현재 터미널 세션을 통해 전달하고, 토큰·비밀번호·Provider
Secret을 저장소 파일이나 명령 인자에 기록하지 않는다.

이 저장소에는 전체 서비스를 한 번에 실행하는 루트 개발 스크립트가 없다. 웹 개발
서버는 필요한 환경변수와 접근 가능한 PostgreSQL을 준비한 뒤 실행한다.

```bash
pnpm --filter web dev
```

변경 사항은 다음 명령으로 검증한다.

```bash
pnpm typecheck
pnpm test
pnpm --filter web build
pnpm --filter worker build
pnpm --filter @deployhub/cli build
```

PostgreSQL 마이그레이션과 전체 Compose 실행 절차는 운영 환경의 네트워크·환경변수
설정에 의존하므로 [배포 가이드](./docs/deployment.md)를 따른다.

## DeployHub CLI

Node.js 22 이상에서 공개 npm 패키지를 설치하지 않고 바로 실행할 수 있다.

```bash
npx @deployhub/cli init --detect
```

CLI는 서버 URL이나 등록 토큰에 기본값을 사용하지 않는다. 서버 URL은
`DEPLOYHUB_URL`, Draft 제출용 토큰은 `DEPLOYHUB_TOKEN` 환경변수로 전달한다.
토큰은 명령 인자로 전달하거나 파일에 저장하지 않는다.

DeployHub 저장소 안에서 CLI를 수정하거나 검증할 때는 먼저 빌드한다.

```bash
pnpm --filter @deployhub/cli build
```

신규 프로젝트의 기본 흐름은 다음과 같다.

```bash
node packages/cli/dist/index.js init --detect
node packages/cli/dist/index.js validate
node packages/cli/dist/index.js register --draft
```

기존 프로젝트의 기본 흐름은 다음과 같다.

```bash
node packages/cli/dist/index.js status
node packages/cli/dist/index.js diff
node packages/cli/dist/index.js validate
node packages/cli/dist/index.js sync --draft
```

`init`이 출력한 `INFERRED FIELDS`와 `UNKNOWN FIELDS`를 사람이 검토하고, 확인된
값만 manifest에 보완한다. YAML 구조나 배포 제공자, 운영 URL을 추측하지 않는다.
`register`와 `sync`는 검증을 통과한 manifest만 Draft로 제출하며, 실제 반영에는
사람의 검토와 승인이 필요하다.

토큰 요구사항과 전체 등록 절차는
[프로젝트 등록 가이드](./docs/project-registration.md)를 참고한다.

## 상세 문서

| 문서 | 내용 |
| --- | --- |
| [운영 배포 가이드](./docs/deployment.md) | Hostinger VPS, Docker Compose, Caddy, 마이그레이션과 배포 검증 |
| [프로젝트 등록 가이드](./docs/project-registration.md) | 토큰 발급, manifest 생성·검증, Draft 제출과 승인 |
| [CLI npm 게시 절차](./docs/cli-npm-publishing.md) | `@deployhub/cli` 패키지 검증과 게시 |
| [DeployHub AGENTS 템플릿](./templates/AGENTS.deployhub.md) | 다른 저장소에서 AI 에이전트가 따라야 할 등록 절차 |
| [저장소 작업 지침](./AGENTS.md) | 이 저장소에서 DeployHub 정보를 동기화하는 규칙 |

## 확정 버전

| 구성 요소 | 버전 |
| --- | --- |
| Node.js | 22.23.1 |
| pnpm | 9.15.0 |
| TypeScript | 6.0.3 |
| Vitest | 4.1.10 |
| PostgreSQL | 17.10 |
| Drizzle ORM | 0.45.2 |
| node-postgres (`pg`) | 8.22.0 |
| Drizzle Kit | 0.31.10 |
| Testcontainers PostgreSQL | 12.0.4 |
| `@types/pg` | 8.20.0 |
| tsup | 8.5.1 |
| Next.js | 16.2.12 |
| Auth.js (`next-auth`) | 5.0.0-beta.32 |
| React | 19.2.8 |
| React DOM | 19.2.8 |
| Caddy | 2.11.4 |
| caddy-ratelimit | v0.1.1-0.20260612195517-5625512f24f6 |

## 라이선스

[MIT](./LICENSE)
````

- [ ] **Step 3: Run the documentation contract again**

Run the Step 1 command again.

Expected: exit 0 with no output.

- [ ] **Step 4: Verify every README relative link resolves**

```powershell
@'
const fs = require('node:fs');
const path = require('node:path');
const text = fs.readFileSync('README.md', 'utf8');
const links = [...text.matchAll(/\[[^\]]+\]\((\.\/[^)#]+)(?:#[^)]+)?\)/g)]
  .map((match) => match[1]);
const missing = [...new Set(links)].filter((link) => !fs.existsSync(path.resolve(link)));
if (missing.length > 0) {
  console.error(`Missing README link targets: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`Verified ${new Set(links).size} relative README links`);
'@ | node
```

Expected: `Verified 7 relative README links`.

- [ ] **Step 5: Verify README commands match workspace scripts and packages**

```powershell
@'
const fs = require('node:fs');
const root = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const web = JSON.parse(fs.readFileSync('apps/web/package.json', 'utf8'));
const worker = JSON.parse(fs.readFileSync('apps/worker/package.json', 'utf8'));
const cli = JSON.parse(fs.readFileSync('packages/cli/package.json', 'utf8'));
const readme = fs.readFileSync('README.md', 'utf8');
const checks = [
  [root.engines.node === '>=22', 'root Node.js engine'],
  [root.packageManager === 'pnpm@9.15.0', 'root pnpm version'],
  [root.scripts.typecheck === 'pnpm -r typecheck', 'root typecheck script'],
  [root.scripts.test === 'vitest run', 'root test script'],
  [web.scripts.dev === 'next dev', 'web dev script'],
  [web.scripts.build === 'next build', 'web build script'],
  [worker.scripts.build === 'tsup', 'worker build script'],
  [cli.name === '@deployhub/cli' && cli.scripts.build === 'tsup', 'CLI package and build script'],
  [readme.includes('pnpm --filter web dev'), 'README web dev command'],
  [readme.includes('pnpm --filter worker build'), 'README worker build command'],
  [readme.includes('pnpm --filter @deployhub/cli build'), 'README CLI build command'],
];
const failed = checks.filter(([ok]) => !ok).map(([, label]) => label);
if (failed.length > 0) {
  console.error(`README command contract failed: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`Verified ${checks.length} README command facts`);
'@ | node
```

Expected: `Verified 11 README command facts`.

- [ ] **Step 6: Scan for secret-like values and formatting errors**

```powershell
$secretPattern = 'dh_reg_[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9]+|AUTH_GITHUB_SECRET=\S+|POSTGRES_PASSWORD=\S+|DEPLOYHUB_TOKEN=\S+'
rg -n $secretPattern README.md
if ($LASTEXITCODE -eq 0) { throw 'README contains a secret-like value' }
if ($LASTEXITCODE -ne 1) { throw 'Secret scan failed to run' }
Write-Output 'No secret-like values found'
git diff --check -- README.md
```

Expected: `No secret-like values found`; `git diff --check` prints nothing and exits 0.

- [ ] **Step 7: Review the rendered structure and commit**

```powershell
rg -n '^#{1,3} ' README.md
git diff -- README.md
git status --short
```

Expected: headings appear in the approved order; only `README.md` is modified.

```bash
git add README.md
git commit -m "docs: rewrite operator README"
```

Expected: one commit containing only the README rewrite.

### Task 2: Run final repository-level documentation verification

**Files:**
- Verify: `README.md`
- Verify: `docs/superpowers/specs/2026-08-01-readme-redesign-design.md`

- [ ] **Step 1: Check the README against the approved design**

Read the design and README side by side:

```powershell
Get-Content -Raw -Encoding utf8 docs/superpowers/specs/2026-08-01-readme-redesign-design.md
Get-Content -Raw -Encoding utf8 README.md
```

Expected: every goal and information-structure item in the design is represented; detailed deployment, manifest-field, Draft-approval, and npm-publishing procedures remain linked rather than duplicated.

- [ ] **Step 2: Re-run the project checks named by the README**

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm --filter web build
pnpm --filter worker build
pnpm --filter @deployhub/cli build
```

Expected: dependency installation leaves `pnpm-lock.yaml` unchanged and all commands exit 0. Existing Next.js warnings about inferred workspace root and the deprecated middleware convention may remain; no new README-related warning or failure is acceptable.

- [ ] **Step 3: Confirm the branch is clean and contains only planned changes**

```powershell
git diff --check main...HEAD
git diff --stat main...HEAD
git status --short
```

Expected: diff check exits 0; the branch diff contains the implementation plan and README only; worktree status is clean.
