# 다른 프로젝트를 DeployHub에 등록하는 방법

DeployHub는 프로젝트를 **선언(manifest) 제출 → 사람 승인**의 2단계로 등록한다.
CLI가 저장소를 훑어 `deployhub.yaml`을 만들고, 그 파일을 Draft로 제출하면,
DeployHub 웹에서 사람이 검토·승인한 뒤에야 실제 프로젝트로 반영된다.
CLI는 아무것도 자동으로 확정하지 않는다.

```
저장소                          DeployHub 서버                 사람
──────                          ──────────────                ────
init --detect ─▶ deployhub.yaml
                     │
validate ────────────┼─▶ GET /api/v1/manifest/schema
                     │
register --draft ────┴─▶ POST /api/v1/project-drafts ─▶ Draft(pending_review)
                                                              │
                                                     /settings/drafts/{id} ─▶ 승인
                                                              │
                                                        projects / components
                                                        / domains 테이블 반영
```

등록 경로는 두 가지다.

| 경로 | 용도 | 필드 출처 기록 | 승인 절차 |
|---|---|---|---|
| **CLI + Draft** (권장) | 저장소가 있는 프로젝트 | 있음 (`fieldSources`) | 있음 |
| **웹 수동 입력** | 저장소가 없거나 급한 보정 | 없음 | 없음(즉시 반영) |

아래는 CLI 경로를 기준으로 설명하고, 웹 수동 입력은 마지막에 따로 다룬다.

---

## 1. 사전 준비

### 1-1. 관리자: 등록 토큰을 발급한다

DeployHub 웹에 로그인해 **Settings → Registration tokens**
(`/settings/tokens`)에서 토큰을 발급한다.

| 입력 | 의미 | 허용 범위 |
|---|---|---|
| 저장소 제한 | 이 토큰으로 제출할 수 있는 GitHub 저장소 (`owner/repo`) | 비우면 제한 없음 |
| 프로젝트 slug 제한 | 이 토큰으로 조회할 수 있는 프로젝트 slug | 비우면 제한 없음 |
| 만료(시간) | 발급 시각 기준 유효 시간 | 1 ~ 720 (30일) |
| 최대 사용 횟수 | Draft 제출 가능 횟수 | 1 ~ 100 |

발급된 토큰 원문(`dh_reg_...`)은 **발급 직후 화면에 한 번만 표시된다.**
서버에는 SHA-256 해시만 저장되므로 다시 볼 수 없다. 화면의 `복사` 버튼으로
복사해 안전한 경로(비밀번호 관리자 등)로 전달한다. 잘못 발급했거나 유출이
의심되면 발급 내역 표의 `폐기` 버튼으로 즉시 무효화한다.

**사용 횟수 산정에 주의한다.** 신규 등록만 하면 1회로 충분하지만, 이후
`sync`로 갱신할 계획이면 갱신 횟수만큼 여유를 둔다. 제한 위반으로 실패한
제출도 사용 횟수를 소모한다(→ [7. 토큰 소모 규칙](#7-토큰-소모-규칙)).

### 1-2. 등록할 프로젝트 쪽 환경

- Node.js 22 이상. 그 외에 설치할 것은 없다.
- 환경변수 두 개. **토큰을 명령 인자로 넘기거나 파일에 저장하지 않는다.**

```bash
export DEPLOYHUB_URL="https://hub.nolzza.net"   # 관리자가 알려준 서버 URL
export DEPLOYHUB_TOKEN="dh_reg_..."             # 위에서 발급받은 토큰
```

PowerShell이라면:

```powershell
$env:DEPLOYHUB_URL = "https://hub.nolzza.net"
$env:DEPLOYHUB_TOKEN = "dh_reg_..."
```

두 변수는 값이 없거나 공백이면 명령이 즉시 실패한다
(`DEPLOYHUB_URL environment variable is required`).

### 1-3. CLI 실행 방식

**다른 저장소에서** — npm 공개 패키지를 `npx`로 실행한다.

```bash
npx @deployhub/cli init --detect
```

자주 쓴다면 `npm install --global @deployhub/cli` 후 `deployhub` 명령을 쓴다.

**DeployHub 저장소 안에서** — 로컬 빌드본을 쓴다.

```bash
pnpm --filter @deployhub/cli build
node packages/cli/dist/index.js init --detect
```

이 문서의 나머지 예시는 `npx @deployhub/cli`로 표기한다.
모든 명령은 **저장소 루트**에서 실행한다. CLI는 항상 현재 디렉터리의
`deployhub.yaml`만 읽고 쓴다.

### 1-4. 명령별 토큰 요구사항

| 명령 | `DEPLOYHUB_URL` | `DEPLOYHUB_TOKEN` | 토큰 사용 횟수 |
|---|---|---|---|
| `init --detect` | 필수 | 불필요 | — |
| `validate` / `validate --remote` | 필수 | 불필요 | — |
| `status` | 필수 | 필수 | 소모하지 않음 |
| `diff` | 필수 | 필수 | 소모하지 않음 |
| `register --draft` | 필수 | 필수 | **1회 소모** |
| `sync --draft` | 필수 | 필수 | **1회 소모** |

---

## 2. 신규 프로젝트 등록 (5단계)

### 단계 1 — 탐지해서 초안을 만든다

```bash
npx @deployhub/cli init --detect
```

`--detect`는 현재 필수다(없으면
`deployhub init currently requires --detect`로 실패한다).
`deployhub.yaml`이 이미 있으면 덮어쓰지 않고 실패한다. 의도적으로 다시
만들려면 `--force`를 붙인다.

출력 예:

```
Wrote /repo/deployhub.yaml
INFERRED FIELDS — review before approval
  - $project.metadata.name
UNKNOWN FIELDS — values were not guessed and are omitted
  - $project.spec.lifecycle
  - web.criticality
  - web.url
NOTE Detected Dockerfile: Dockerfile
NOTE Detected GitHub Actions workflow: .github/workflows/ci.yml
NOTE Environment keys declared in .env.example: DATABASE_URL, SESSION_SECRET
```

세 구획의 뜻이 다르다.

- **INFERRED FIELDS** — 확실한 근거 없이 추정한 값. 값이 파일에 들어가
  있으니 **사실인지 확인하고 고쳐야 한다.**
- **UNKNOWN FIELDS** — 추측하지 않고 **비워 둔** 필드. 아는 값이 있으면
  직접 채운다. 모르면 그대로 둔다.
- **NOTE** — manifest에 반영하지 않은 참고 사항. 컴포넌트 후보로 볼 만한
  compose 서비스, Dockerfile, CI 워크플로, `.env.example` 키 등.

### 단계 2 — 사람이 `deployhub.yaml`을 검토·보완한다

`init`은 **`spec.lifecycle`을 채우지 않는다.** 필수 필드이므로 반드시
직접 넣어야 검증을 통과한다. 그 밖에 확인된 값(운영 URL, 컨테이너 이름,
provider, 중요도)을 채운다. **근거 없이 그럴듯한 값을 지어내지 않는다.**

완성된 파일의 형태(이 저장소의 실제 `deployhub.yaml`):

```yaml
# yaml-language-server: $schema=https://hub.nolzza.net/schemas/deployhub-v1.json
apiVersion: deployhub.io/v1
kind: Project
metadata:
  name: DeployHub
  slug: deployhub
  description: 통합 프로젝트·인프라 관리 시스템
spec:
  lifecycle: production
  importance: 4
  owner: gnghkim
  repository:
    provider: github
    slug: gnghkim/DeployHub
  components:
    - name: web
      type: frontend
      framework: nextjs
      runtime: nodejs
      language: typescript
      criticality: 4
      path: apps/web
      provider: hostinger
      container: deployhub-web
      url: https://hub.nolzza.net
    - name: database
      type: database
      runtime: postgresql
      criticality: 5
      provider: self-hosted
      container: deployhub-postgres
  domains:
    - domain: hub.nolzza.net
      environment: production
  documents:
    - type: readme
      path: README.md
```

첫 줄의 `$schema` 주석은 `init`이 `DEPLOYHUB_URL` 기준으로 넣는다. VS Code
등의 YAML 언어 서버가 이 주석을 읽어 편집 중에 자동완성과 검증을 해 준다.
지우지 않는다.

필드의 자세한 규칙은 [4. manifest 필드 레퍼런스](#4-manifest-필드-레퍼런스)에 있다.

### 단계 3 — 검증한다

```bash
npx @deployhub/cli validate
```

서버에서 JSON Schema를 받아 로컬에서 검사한다. 통과하면:

```
Valid deployhub.yaml (schema deployhub.io/v1 from server)
```

실패하면 필드 경로와 함께 오류가 나오고 종료 코드는 1이다.

```
ERROR spec.lifecycle: Required field is missing
ERROR spec.components[0].provider: Expected one of vercel, hostinger, supabase, ...
```

스키마는 `~/.cache/deployhub/schema-v1.json`에 ETag와 함께 캐시된다.
서버에 닿지 못해도 캐시가 1시간 이내면 경고를 내고 캐시로 검증을 계속한다.

서버 쪽 파서와 결과가 같은지까지 확인하려면 `--remote`를 붙인다. 이때도
토큰은 필요 없다.

```bash
npx @deployhub/cli validate --remote
```

```
Valid deployhub.yaml (schema deployhub.io/v1 from server)
Local and remote validation results agree
```

### 단계 4 — Draft로 제출한다

```bash
npx @deployhub/cli register --draft
```

`--draft`는 필수 옵션이다. CLI에 승인까지 하는 경로는 없다.

`register`는 네트워크 호출 전에 (1) `deployhub.yaml` 파싱, (2) 스키마 검증을
먼저 한다. 둘 중 하나라도 실패하면 **토큰을 쓰지 않고** 종료 코드 1로
끝난다. 통과하면 다시 한 번 탐지를 돌려 필드 출처(`fieldSources`)를 모으고,
manifest 원문과 함께 제출한다.

```
Valid deployhub.yaml (schema deployhub.io/v1 from server)
Draft submitted: https://hub.nolzza.net/settings/drafts/0f3c...e21
```

### 단계 5 — 사람이 웹에서 승인한다

출력된 URL을 열면 Draft 상세 화면이 나온다. 네 구획을 검토한다.

1. **변경 요약** — 프로젝트 필드/구성요소/도메인의 추가·변경·삭제.
   신규 등록이면 모든 구성요소가 `추가`로 표시된다.
2. **배포 선언** — 구성요소별 `provider` / `externalRef` / `container` /
   `url`. `inferred`로 표시된 값은 주의색으로 강조된다.
3. **검증 결과** — 서버 파싱 시점의 오류와 경고.
4. **필드 출처** — 각 필드를 어떻게 알아냈는지(`detected` / `inferred` /
   `unknown`)와 근거 파일.

`승인`을 누르면 그 자리에서 DB에 반영된다. 반영 규칙은
[6. 승인이 실제로 하는 일](#6-승인이-실제로-하는-일)에 있다. `거부`를
누르면 Draft만 `rejected`가 되고 프로젝트에는 아무 변화가 없다.
승인·거부는 `pending_review` 상태의 Draft에만 가능하다.

---

## 3. 자동 탐지가 찾는 것

`init --detect`와 `register`/`sync`가 돌리는 탐지의 범위는 아래가 전부다.
여기 없는 것은 **탐지되지 않으므로 사람이 직접 적어야 한다.**

| 대상 | 근거 | 만들어지는 값 |
|---|---|---|
| 프로젝트 이름 | `package.json`의 `name` (스코프 제거) → `pyproject.toml`의 `[project]`/`[tool.poetry]` name → 디렉터리 이름 | `metadata.name`, 정규화한 `metadata.slug` |
| 저장소 | `git remote get-url origin` → 실패 시 `.git/config` | `spec.repository` (github만) |
| Next.js 앱 | 의존성에 `next` | `type: frontend`, `framework: nextjs`, `runtime: nodejs` |
| Express 앱 | 의존성에 `express` | `type: backend`, `framework: express`, `runtime: nodejs` |
| 워커 | 패키지 이름이 `/worker/i`에 일치 | `type: worker`, `runtime: nodejs` |
| FastAPI | `requirements.txt` 또는 `pyproject.toml`의 `fastapi` | `type: api`, `framework: fastapi`, `runtime: python` |
| 데이터베이스 | `prisma/schema.prisma` 또는 루트의 `drizzle.config.*` | `type: database`, `framework: prisma`/`drizzle` |
| TypeScript 여부 | 의존성의 `typescript` 또는 해당 디렉터리의 `tsconfig.json` | `language: typescript` |
| 컨테이너 | compose 파일의 서비스가 컴포넌트 이름과 일치 | `container`, `provider: docker`(inferred) |

Node 컴포넌트는 루트 이하의 모든 `package.json`을 훑어 찾는다(단
`node_modules`, `.git`, `.next`, `dist`, `test`/`tests`, `fixtures` 등은
제외). 모노레포의 `apps/web`, `apps/worker`가 각각 별도 구성요소가 된다.

**탐지되지 않는 대표 항목** — `lifecycle`, `importance`, `criticality`,
`owner`, `url`, `domains`, `documents`, `externalRef`, 그리고 docker 이외의
`provider`. compose에 없는 서비스는 NOTE로만 알려주고 구성요소로 만들지
않는다.

### 필드 출처(origin)

제출된 `fieldSources`는 Draft 화면에 그대로 표시되어 검토자가 "이 값이 어디서
왔는가"를 판단하는 근거가 된다.

| origin | 뜻 | 검토자가 할 일 |
|---|---|---|
| `detected` | 파일에서 확인한 사실 (근거 파일이 함께 기록됨) | 그대로 신뢰 가능 |
| `inferred` | 근거로부터 추론한 값 | **확인 필요** |
| `unknown` | 알 수 없어 비워 둔 값 | 필요하면 사람이 채움 |
| `declared` | 사람이 직접 선언한 값 | — |

---

## 4. manifest 필드 레퍼런스

스키마는 **strict**다. 표에 없는 키를 넣으면
`Unknown field is not allowed`로 거부된다.

### 최상위

| 필드 | 필수 | 값 |
|---|---|---|
| `apiVersion` | ✅ | `deployhub.io/v1` 고정 |
| `kind` | ✅ | `Project` 고정 |
| `metadata` | ✅ | 아래 |
| `spec` | ✅ | 아래 |

### `metadata`

| 필드 | 필수 | 규칙 |
|---|---|---|
| `name` | ✅ | 빈 문자열 불가 |
| `slug` | ✅ | `^[a-z0-9]+(-[a-z0-9]+)*$` — **프로젝트의 식별자** |
| `description` | | 자유 문자열 |

`slug`가 곧 프로젝트 동일성의 기준이다. 승인 시 같은 slug의 프로젝트가 있으면
갱신하고, 없으면 새로 만든다. **slug를 바꾸면 다른 프로젝트가 된다.**

### `spec`

| 필드 | 필수 | 규칙 |
|---|---|---|
| `lifecycle` | ✅ | `experimental` \| `development` \| `production` \| `deprecated` |
| `importance` | | 1~5 정수 (미지정 시 승인할 때 3) |
| `owner` | | 자유 문자열 |
| `repository` | | `{ provider: github, slug: "owner/repo" }` — provider는 `github`만 |
| `components` | ✅ | **1개 이상**, 이름 중복 불가 |
| `domains` | | `{ domain, environment }` 배열 |
| `documents` | | `{ type, path }` 배열. **아직 저장하지 않는다** — 선언하면 검증이 경고를 내고 승인 시 무시된다 |

### `spec.components[]`

| 필드 | 필수 | 규칙 |
|---|---|---|
| `name` | ✅ | slug 형식(소문자·숫자·하이픈). 프로젝트 안에서 유일 |
| `type` | ✅ | `frontend` `backend` `api` `worker` `scheduler` `database` `authentication` `storage` `cache` `queue` `monitoring` |
| `framework` | | 자유 문자열 (`nextjs`, `fastapi`, `prisma` 등) |
| `runtime` | | 자유 문자열 (`nodejs`, `python`, `postgresql` 등) |
| `language` | | 자유 문자열 |
| `criticality` | | 1~5 정수 (미지정 시 승인할 때 3) |
| `path` | | 저장소 내 상대 경로 |
| `provider` | | `vercel` `hostinger` `supabase` `docker` `github` `aws` `cloudflare` `upstash` `railway` `neon` `planetscale` `self-hosted` **중에서만** |
| `externalRef` | | Supabase project ref, Vercel project id 등 제공자 내부 식별자 |
| `container` | | `^[a-zA-Z0-9][a-zA-Z0-9_.-]*$` — 운영 배포에서 확인한 컨테이너 이름 |
| `url` | | `http://` 또는 `https://`로 시작하는 확인된 운영 URL |

**`provider`는 위 목록에만 있는 값을 쓴다.** 목록에 없는 제공자를 쓰고 있다면
값을 지어내지 말고 생략한다. `url`도 마찬가지로 파일에서 확인할 근거가 없으면
비워 둔다.

---

## 5. 기존 프로젝트 갱신

기술 구성이나 배포 환경이 바뀌면 같은 흐름을 반복한다. 다른 점은
`register` 대신 `sync`를 쓰고, 앞에 현황 확인이 붙는다는 것뿐이다.

```bash
npx @deployhub/cli status   # 서버에 등록된 상태 확인
npx @deployhub/cli diff     # 로컬 manifest와 서버 선언의 차이 확인
#   → 필요하면 deployhub.yaml 수정
npx @deployhub/cli validate
npx @deployhub/cli sync --draft
#   → 출력된 Draft URL에서 사람이 승인
```

`status` 출력:

```
Registration: registered
Project: DeployHub (active)
Lifecycle: production
Components: 4
Linked resources: 2
Latest Draft: approved
Draft URL: https://hub.nolzza.net/settings/drafts/0f3c...e21
URL: https://hub.nolzza.net/projects/deployhub
```

아직 등록 전이면 `Registration: not registered` 한 줄만 나오고 정상 종료한다.
등록 여부를 스크립트에서 확인할 때 쓸 수 있다.

`diff` 출력:

```
Project changes:
  lifecycle: development -> production
Components added: scheduler
Component changes:
  web.url: (none) -> https://hub.nolzza.net
Components absent from manifest (not automatically deleted): legacy-api
Domains added: hub.nolzza.net
```

**`diff`에서 "absent from manifest"로 표시된 구성요소는 자동으로 삭제되지
않는다.** manifest에서 지웠다고 서버에서 사라지지 않는다. 실제로 없애려면
웹에서 직접 처리한다. 도메인은 예외다(아래 참고).

`sync`는 `register`와 달리 제출 전에 서버의 현재 선언을 조회해 diff를 함께
보낸다. 그래서 **아직 등록되지 않은 프로젝트에 `sync`를 쓰면**
`DeployHub project "<slug>" is not registered`로 실패한다. 첫 등록은 반드시
`register`를 쓴다.

---

## 6. 승인이 실제로 하는 일

Draft 승인은 하나의 트랜잭션으로 다음을 수행한다.

1. **Draft 상태**를 `approved`로 바꾸고 검토자와 시각을 기록한다.
   (`pending_review`가 아닌 Draft는 승인할 수 없다.)
2. **프로젝트** — `metadata.slug`로 기존 프로젝트를 찾아 갱신하고, 없으면
   새로 만든다. `importance`가 없으면 3이 들어간다.
3. **구성요소** — `(프로젝트, 구성요소 slug)` 기준으로 upsert한다. 즉
   **추가와 수정만 하고 삭제는 하지 않는다.** manifest에서 빠진 구성요소는
   서버에 그대로 남는다. `criticality`가 없으면 3이 들어간다.
4. **도메인** — 구성요소와 달리 **기존 도메인을 모두 지우고 manifest의
   목록으로 교체한다.** manifest에서 도메인을 빠뜨리면 서버에서도 사라진다.
5. `/settings/drafts`, `/projects` 캐시를 무효화한다.

manifest 파싱에 실패하는 Draft(`validation_failed`)는 승인 대상이 아니다.

---

## 7. 토큰 소모 규칙

토큰은 **Draft 제출(`POST /api/v1/project-drafts`)에서만** 소모된다.
`status`와 `diff`는 검증만 하고 사용 횟수를 늘리지 않는다.

소모 시점이 중요하다. 서버는 **요청 본문을 읽은 직후, manifest를 파싱하기
전에** 토큰을 소모한다. 따라서:

- ✅ 로컬 검증 실패로 `register`가 중단된 경우 → **소모되지 않음**
  (CLI가 네트워크 요청 자체를 하지 않는다)
- ❌ 서버가 manifest 파싱에 실패한 경우 → **소모됨.**
  Draft는 `validation_failed` 상태로 저장되고 응답은 201이다.
- ❌ 저장소 제한 위반(403)인 경우 → **소모됨.** 제한 검사가 토큰 소모
  뒤에 일어난다.

만료·폐기된 토큰은 401로 거부되며 사용 횟수는 늘지 않는다. 횟수를 다 쓴
토큰도 Draft 제출은 401로 거부된다. 다만 **`status`와 `diff`는 횟수를 다 쓴
뒤에도 계속 동작한다.** 사용 횟수는 Draft 제출에만 걸리는 제한이므로, 1회용
토큰으로 등록한 뒤에도 현황 조회는 만료 전까지 가능하다.

### 제한이 걸리는 지점

| 제한 | Draft 제출 | `status` / `diff` |
|---|---|---|
| 저장소 제한 | manifest의 `spec.repository.slug`와 비교, 불일치 시 403 | 서버에 저장된 프로젝트의 repository와 비교, 불일치 시 403 |
| 프로젝트 slug 제한 | manifest의 `metadata.slug`와 비교, 불일치 시 403 | 요청한 slug와 비교, 불일치 시 403 |

저장소 제한이 걸린 토큰으로 `spec.repository`가 **없는** manifest를 제출하면
비교 대상이 없어 403이 된다. 이 경우 manifest에 저장소를 명시해야 한다.

---

## 8. 다른 저장소의 AI 에이전트에게 맡길 때

같은 절차를 AI 에이전트가 따르게 하려면
[`templates/AGENTS.deployhub.md`](../templates/AGENTS.deployhub.md)를 그
저장소의 기존 지침(`AGENTS.md`, `CLAUDE.md` 등)에 **합쳐서** 넣는다.
**기존 파일을 덮어쓰지 않는다.**

템플릿은 명령 순서, 토큰 요구사항, 그리고 "YAML 구조를 추측하지 말 것",
"확인되지 않은 URL·provider를 지어내지 말 것" 같은 금지 사항을 담고 있다.
에이전트에게 토큰을 다루게 할 때는 **환경변수로만** 전달하고, 대화나 로그에
값이 남지 않게 한다.

---

## 9. 웹에서 수동으로 등록하기

저장소가 없거나 Draft 절차 없이 항목만 만들어야 할 때는 웹에서 직접
입력한다.

1. `/projects/new` — 이름, slug, 설명, 상태, lifecycle, 중요도, 담당자,
   저장소를 입력해 프로젝트를 만든다.
2. `/projects/{slug}/components/new` — 구성요소를 하나씩 추가한다.
3. `/projects/{slug}/edit` — 이후 수정.

이 경로는 즉시 반영되며 **필드 출처가 기록되지 않고 검토 이력도 남지
않는다.** 가능하면 CLI + Draft 경로를 쓴다.

slug가 이미 있으면 `이미 사용 중인 slug입니다.`로 거부된다.

---

## 10. 문제 해결

| 증상 | 원인 | 대응 |
|---|---|---|
| `DEPLOYHUB_URL environment variable is required` | 환경변수 미설정 또는 공백 | `export DEPLOYHUB_URL=...` |
| `deployhub init currently requires --detect` | `--detect` 없이 `init` 실행 | `--detect`를 붙인다 |
| `... already exists; use --force to overwrite it` | `deployhub.yaml`이 이미 있음 | 기존 파일을 쓰거나 `--force` |
| `ERROR spec.lifecycle: Required field is missing` | `init`이 채우지 않는 필수 필드 | 직접 값을 넣는다 |
| `ERROR ...: Unknown field is not allowed` | 스키마에 없는 키 | [4. 필드 레퍼런스](#4-manifest-필드-레퍼런스)의 키만 사용 |
| `ERROR ...: Expected one of vercel, hostinger, ...` | 허용되지 않는 `provider` | 목록의 값을 쓰거나 생략 |
| `Unable to fetch the DeployHub manifest schema and no cache is available` | 서버에 닿지 못하고 캐시도 없음 | `DEPLOYHUB_URL`과 네트워크 확인 |
| `Unsupported DeployHub manifest version ...` | 서버와 CLI의 manifest 버전 불일치 | CLI를 최신 버전으로 올린다 |
| `DeployHub Draft submission failed with HTTP 401` | 토큰이 없거나 만료·폐기·소진됨 | 새 토큰을 발급받는다 |
| `... HTTP 403` | 저장소 제한 위반 | manifest의 `spec.repository.slug`와 토큰 제한을 맞춘다 |
| `... HTTP 413` | 본문이 256KB를 넘음 | manifest를 줄인다 |
| `DeployHub project "<slug>" is not registered` | 미등록 프로젝트에 `sync`/`diff` 사용 | 첫 등록은 `register --draft` |
| `Unable to reach the DeployHub ... endpoint` | 서버 접속 실패 | URL·네트워크·서버 상태 확인 |
| Draft가 `validation_failed`로 생성됨 | 서버 파서가 manifest를 거부 | Draft 화면의 검증 결과를 고치고 재제출(토큰 1회 추가 소모) |

---

## 참고

- [AGENTS.md](../AGENTS.md) — 이 저장소에서 AI가 따라야 할 등록 절차
- [templates/AGENTS.deployhub.md](../templates/AGENTS.deployhub.md) — 다른 저장소용 템플릿
- [docs/cli-npm-publishing.md](./cli-npm-publishing.md) — CLI 게시 절차
- `packages/manifest/src/schema.ts` — 스키마 정의 원본
