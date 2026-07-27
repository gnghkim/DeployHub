# DeployHub M2 (뒷단 파악) Implementation Plan

> **For agentic workers:** orca orchestration으로 codex 워커에게 카드 단위 위임된다. 각 Task는 격리 worktree에서 수행하고, 검증 명령이 모두 통과한 뒤 Claude의 설계 부합 검토를 거쳐 main에 병합한다.

**Goal:** 구축방안 1.1의 질문 ①에 답한다 — **등록된 각 프로젝트가 어떤 서비스 위에서 구동되고 있는가.** 뒷단은 **AI가 선언**하고, 구동 실체는 **Collector가 관측**하며, 둘이 어긋나면 **Drift로 표시**한다.

**Architecture:** manifest의 `provider`·`externalRef`·`container`가 선언을 담고, Docker·Vercel Collector가 실행 중인 실체를 수집한다. 선언에 적힌 참조값으로 관측 자원을 자동 연결하고, 선언은 있는데 관측되지 않거나 그 반대인 경우를 Drift로 잡는다.

**Tech Stack:** 기존 스택. **새 외부 의존성 없음** — Docker는 socket-proxy에 HTTP, Vercel은 REST에 `fetch`.

**선행 문서:** `docs/superpowers/specs/2026-07-26-deployhub-구축방안.md`, 원본 계획서 §14.3, M1a·M1b·M1c 계획서

---

## 설계 수정 — 추론이 아니라 선언

**초안은 `packages/fingerprint` 규칙 엔진으로 뒷단을 추론하려 했다. 그것은 우선순위가 틀렸다.**

프로젝트를 코딩하는 AI는 뒷단이 무엇인지 **이미 안다.** 코드를 읽고 통합을 직접 짰으므로 `SUPABASE_URL`이 Supabase를 뜻한다는 것을 추론할 필요가 없다. 원본 계획서 §14.3의 manifest 예시도 처음부터 그렇게 설계돼 있었다.

```yaml
components:
  - name: web
    type: frontend
    provider: vercel
    url: https://linkvault.it
  - name: worker
    provider: hostinger
    container: linkvault-worker
  - name: database
    provider: supabase
    externalRef: abcdefghijklmnop
```

**M1c의 manifest 스키마가 이 필드들을 빠뜨렸다.** 지금은 `framework`·`runtime`·`language`·`criticality`·`path`만 있어 AI가 "이건 Supabase다"라고 선언할 방법이 없다. M2 Task 1이 이를 복원한다.

### 세 질문을 구분한다

| 질문 | 답하는 방법 | 이유 |
|---|---|---|
| 뒷단에 **무엇을** 쓰는가 | **선언** (manifest `provider`) | AI가 직접 안다. 추론보다 정확하다 |
| **어디서** 구동되는가 | **관측** (Docker·Vercel Collector) | 선언은 의도이고 관측은 사실이다. 컨테이너가 지금 떠 있는지, 어떤 이미지 태그로 도는지는 관측해야 안다 |
| 둘이 **일치하는가** | **Drift** (선언 ↔ 관측 대조) | 선언은 낡는다. 양쪽이 다 있어야 잡힌다 |

`packages/fingerprint`는 **M2에서 뺀다.** 등록되지 않은 저장소 40개의 뒷단을 `package.json`으로 추정하는 용도는 남아 있지만, 그것은 "등록된 것을 정확히 하기"보다 뒤에 온다. M3 이후로 미룬다.

---

## 배포 환경의 제약 (실측)

**공용 VPS다.** 12개 컨테이너가 돌고 그중 9개는 다른 프로젝트다.

```
linkvault-worker-1   bmsimul-bmsimul-1     yield-api-1
yield-postgres-1     workwiki-backend      workwiki-postgres
ktgo-postgres        reporthub-reporthub-1 caddy-caddy-1
deployhub-web        deployhub-worker      deployhub-postgres
```

Docker Collector는 이 전부를 본다. 그것은 의도된 것이다 — 구축방안 16.6이 Label 없는 컨테이너를 `Unlinked`로 표시하라고 했다.

**그런데 `docker inspect`는 환경변수 값을 그대로 반환한다.** 실측으로 확인했다.

```
$ docker inspect deployhub-postgres --format '{{range .Config.Env}}{{.}}{{"\n"}}{{end}}'
POSTGRES_USER=deployhub
POSTGRES_PASSWORD=<실제 값>
POSTGRES_DB=deployhub
```

순진하게 수집하면 **다른 프로젝트 DB 세 개(`yield-postgres`, `workwiki-postgres`, `ktgo-postgres`)의 비밀번호가 우리 DB에 평문으로 들어간다.** 우리 것이 아닌 남의 자격증명이다. **이것이 M2의 첫 번째 규칙이며 Task 4의 절대 규칙으로 못박는다.**

---

## Global Constraints

M1a·M1b·M1c의 Global Constraints를 그대로 승계하고 아래를 더한다.

- **관측 데이터는 허용목록(allowlist)으로 구성한다.** API 응답을 통째로 `metadata`에 넣지 마라. 필요한 필드만 명시적으로 골라 담는다. **차단목록은 새 필드가 추가될 때 뚫린다.**
  - **허용목록은 최상위 키에서 멈추지 않는다. 중첩된 객체 안에도 적용한다.** Task 4에서 실제로 뚫렸다 — `metadata.labels`가 허용목록에 들어 있다는 이유로 `Config.Labels` 전체가 통과했고, compose가 붙이는 라벨 셋(`config_files`·`working_dir`·`environment_file`)이 호스트 경로였다. 마지막은 남의 프로젝트 `.env` 위치다. `Mounts[].Source`를 호스트 경로라고 막아 놓고 같은 것이 라벨로 들어온 것이다.
  - 값이 자유 문자열인 필드(라벨, 태그, 주석, 사용자 지정 메타데이터)는 **키 자체를 허용목록으로 거른다.** Docker 라벨은 `deployhub.`·`org.opencontainers.image.` 접두사만 남긴다.
- **환경변수는 이름만 저장한다.** 값은 어떤 경로로도 저장·로그·응답에 남기지 않는다.
- **관측 이력을 지우지 않는다.** 사라진 자원은 `deleted_at`을 채운다.
- **시간은 DB 시계만 쓴다.**
- **모든 Zod 문자열에 `.trim()`.**
- **새 외부 의존성을 추가하지 않는다.**
- **`docs/`는 각 Task의 산출물이 아니다.**

---

## Task 1: manifest 선언 확장

AI가 뒷단을 직접 적을 수 있게 한다. 이 카드가 M2의 전제다.

**Files:**
- Modify: `packages/manifest/src/schema.ts`, `schema.test.ts`
- Modify: `packages/db/src/schema/projects.ts` (components 컬럼 추가)
- Create: `drizzle/0004_*.sql`
- Modify: `packages/manifest/src/diff.ts`, `diff.test.ts`
- Modify: `apps/web/src/actions/drafts.ts` (승인 시 새 필드 반영)
- Modify: `apps/web/src/app/drafts/[id]/page.tsx`
- Modify: `packages/cli/src/detectors/index.ts` (탐지 가능한 것 채우기)
- Modify: `AGENTS.md`, `deployhub.yaml`

**Interfaces:**

```ts
// manifest component 에 추가되는 필드 (모두 optional)
provider?: 'vercel' | 'hostinger' | 'supabase' | 'docker' | 'github'
         | 'aws' | 'cloudflare' | 'upstash' | 'railway' | 'neon'
         | 'planetscale' | 'self-hosted';
externalRef?: string;   // Supabase project ref, Vercel project id 등
container?: string;     // Docker 컨테이너 이름
url?: string;           // 운영 URL
```

- [ ] **Step 1: 실패하는 스키마 테스트 작성**

검증할 것:
1. `provider`가 허용 목록 밖이면 거부한다 (`provider: mycloud` → 오류)
2. 네 필드 모두 optional이다 — 없어도 기존 manifest가 통과한다
3. 문자열 앞뒤 공백이 제거된다
4. `externalRef`가 빈 문자열이면 `undefined`가 된다
5. `container`가 Docker 이름 규칙을 만족해야 한다 (`^[a-zA-Z0-9][a-zA-Z0-9_.-]*$`)
6. `url`이 `http://` 또는 `https://`로 시작해야 한다
7. `.strict()`가 여전히 알 수 없는 키를 거부한다

**`provider`를 열린 문자열로 두지 않는 이유:** 오타(`superbase`)가 조용히 통과하면 카탈로그가 흐려지고 자동 연결이 실패한다. 새 provider가 필요하면 목록에 한 줄 추가하는 것이 옳은 마찰이다.

- [ ] **Step 2: 실패 확인 → 스키마 구현**

`provider` 목록은 위 Interfaces의 12개로 시작한다. `other`를 넣지 마라 — 검증할 수 없는 값이 들어오면 목록의 의미가 사라진다.

- [ ] **Step 3: DB 컬럼 추가와 마이그레이션**

`components`에 네 컬럼을 더한다. **`provider`는 `text`로 둔다** — pgEnum으로 하면 provider를 하나 늘릴 때마다 마이그레이션이 필요하다. 값의 유효성은 manifest Zod가 지킨다.

```ts
provider: text('provider'),
externalRef: text('external_ref'),
containerName: text('container_name'),
url: text('url'),
```

`(provider, external_ref)`와 `container_name`에 인덱스를 만든다. Task 5의 자동 연결이 이 값으로 조회한다.

Run: `pnpm --filter @deployhub/db exec drizzle-kit generate`

**생성된 SQL을 반드시 읽어라.** 운영 DB에 적용된다. `components`에 컬럼 4개와 인덱스를 **추가**할 뿐이어야 한다. 다른 테이블을 건드리거나 기존 컬럼을 바꾸는 문장이 있으면 멈추고 보고하라.

- [ ] **Step 4: diff와 승인 반영**

`diffManifest`가 새 필드의 변경을 잡아야 한다. 테스트로 고정하라 — `provider`가 `supabase`에서 `neon`으로 바뀌면 `componentsChanged`에 나타날 것.

승인 Action이 네 필드를 `components`에 반영한다. **기존 트랜잭션 안에서 처리하라.**

승인 화면에 `provider`·`externalRef`·`container`를 표시한다. `field_sources`가 `inferred`인 항목은 기존대로 강조한다.

- [ ] **Step 5: CLI detector가 채울 수 있는 것 채우기**

detector가 근거를 갖고 알 수 있는 것만 채운다. **추측 금지 원칙(M1c Task 4 절대 규칙 E)은 그대로다.**

| 필드 | 탐지 근거 | origin |
|---|---|---|
| `container` | `compose.yaml`의 `container_name` 또는 `services.<name>` | `detected` |
| `provider` | compose 파일이 있고 서비스가 매칭되면 `docker` | `inferred` |
| `url` | 없음 — 파일에서 알 수 없다 | `unknown` |
| `externalRef` | 없음 | `unknown` |

`provider`를 `inferred`로 두는 이유: compose 파일이 있다고 그 컨테이너가 실제로 그 서버에서 도는지는 알 수 없다. 사람이 확인해야 한다.

- [ ] **Step 6: DeployHub 자신의 manifest 갱신**

`deployhub.yaml`의 세 구성요소에 선언을 채운다.

```yaml
  - name: web
    provider: hostinger
    container: deployhub-web
    url: https://hub.nolzza.net
  - name: worker
    provider: hostinger
    container: deployhub-worker
  - name: database
    provider: self-hosted
    container: deployhub-postgres
```

`database`가 `self-hosted`인 것이 요점이다 — Supabase가 아니라 우리가 돌리는 `postgres:17-alpine` 컨테이너다. **이 선언이 Task 5에서 관측된 컨테이너와 자동으로 이어진다.**

`AGENTS.md`에 새 필드 설명을 더한다. AI가 읽는 지침이므로 각 필드를 언제 적어야 하는지 분명히 쓴다.

- [ ] **Step 6.5: 스키마 캐시 무효화 수정** (M1c 설계 결함)

`X-Manifest-Version`은 `deployhub.io/v1`로 **유지되는 것이 옳다.** 선택 필드를 더한 것은 하위호환 변경이므로 v2로 올리면 기존 manifest가 전부 깨진다. 그런데 M1c의 schema-client는 캐시 무효화를 **버전 헤더에만** 걸었다. 같은 버전 안에서 스키마 내용이 바뀌면 CLI가 낡은 사본으로 검증해 새 필드를 거부한다.

두 헤더는 서로 다른 것을 뜻한다.

| 헤더 | 의미 |
|---|---|
| `X-Manifest-Version` | 호환성 계약. CLI가 이 스키마를 **이해할 수 있는가** |
| `ETag` | 내용 동일성. 캐시한 사본이 **최신인가** |

- 서버는 ETag를 JSON Schema 본문의 안정적 해시로 만든다. 타임스탬프나 빌드 ID를 쓰지 마라 — 같은 스키마면 재배포해도 같은 ETag여야 불필요한 재조회가 없다. 직렬화를 결정적으로 하라.
- CLI는 캐시에 ETag를 함께 저장하고 매 실행마다 `If-None-Match`로 조건부 요청한다. `304`면 캐시 사용, `200`이면 교체.
- **TTL의 의미를 바꾼다.** 지금은 "TTL 안이면 서버에 묻지 않는다"라서 이 문제가 생겼다. 앞으로 TTL은 **오프라인일 때 캐시를 얼마나 오래 신뢰하는가**만 정한다. 온라인이면 항상 조건부 재검증한다 — `304`는 본문이 없어 비용이 거의 없다.
- 버전 불일치는 캐시 폐기를 넘어 **명확한 오류로 실패**한다. 이해하지 못하는 스키마로 검증하면 안 된다.
- 오프라인 + 캐시 있음 → 경고 출력(M1c 규칙 유지). 캐시도 없으면 실패.

- [ ] **Step 7: 검증과 커밋**

Run: `pnpm typecheck && pnpm vitest run && pnpm --filter web build`
Run: `node packages/cli/dist/index.js validate` — 갱신한 `deployhub.yaml`이 통과해야 한다

**게이트 통과 조건:** 스키마 테스트 7건 통과. 마이그레이션이 `components`에 컬럼 추가만 할 것. `deployhub.yaml`이 검증을 통과할 것.

---

## Task 2: 관측 스키마와 socket-proxy

**Files:**
- Create: `packages/db/src/schema/observations.ts` (`deployments`, `containerSnapshots`)
- Create: `drizzle/0005_*.sql`
- Create: `packages/db/src/queries/observations.ts`, `observations.test.ts`
- Modify: `packages/db/src/schema/index.ts`, `packages/db/src/index.ts`
- Modify: `docker/compose.yml`, `.env.example`, `packages/shared/src/env.ts`

**Interfaces:**

```ts
deployments:        id, project_id(null), component_id(null), provider, environment,
                    version, commit_sha, image_name, external_deployment_id, status,
                    deployment_url, started_at, completed_at, metadata, created_at
                    UNIQUE(provider, external_deployment_id)
containerSnapshots: id, resource_id, cpu_pct, mem_bytes, restart_count, observed_at

export function recordSnapshots(db, rows: SnapshotInput[]): Promise<void>;
export function pruneSnapshots(db, olderThanDays: number): Promise<number>;
export function upsertDeployment(db, input: DeploymentInput): Promise<void>;
```

- [ ] **Step 1: 실패하는 테스트 작성**

검증할 것:
1. `containerSnapshots`가 같은 `resource_id`에 여러 행을 **누적**한다 (갱신이 아님)
2. `observed_at` 기본값이 DB `now()`다 — 앱에서 넣은 시각이 아님을 단언
3. `pruneSnapshots(14)`가 14일보다 오래된 행만 지운다
4. 자원이 삭제되면 스냅샷도 함께 삭제된다 (`on delete cascade`)
5. `upsertDeployment`가 `(provider, external_deployment_id)` 충돌 시 갱신한다
6. `deployments.project_id`가 null이어도 저장된다

- [ ] **Step 2: 실패 확인 → 구현 → 마이그레이션**

`containerSnapshots`에 `(resource_id, observed_at)` 인덱스. 조회가 항상 자원별 시간 범위다.

**생성된 SQL을 읽어라.** 테이블 2개 추가뿐이어야 한다.

- [ ] **Step 3: compose에 socket-proxy 추가**

```yaml
  socket-proxy:
    image: tecnativa/docker-socket-proxy
    container_name: deployhub-socket-proxy
    restart: unless-stopped
    environment:
      CONTAINERS: 1
      IMAGES: 1
      NETWORKS: 1
      VOLUMES: 1
      INFO: 1
      POST: 0
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    networks: [deployhub]
    labels:
      deployhub.project: "deployhub"
      deployhub.component: "socket-proxy"
      deployhub.environment: "production"
```

**`ports`를 넣지 마라.** `POST: 0`이 생성·삭제·exec를 전면 차단한다(구축방안 12.2).

**전용 internal 네트워크로 격리한다.** `deployhub` 망에 두면 web도 이미 그 망에 있어 접근할 수 있다 — "web을 붙이지 마라"는 문장으로는 아무것도 강제되지 않는다. 네트워크 구조로 막는다.

```yaml
networks:
  deployhub:                # postgres, web, worker
  docker-api:
    internal: true          # worker 와 socket-proxy 만
  web:
    external: true          # 공용 Caddy 용

services:
  postgres:      networks: [deployhub]
  web:           networks: [deployhub, web]
  worker:        networks: [deployhub, docker-api]
  socket-proxy:  networks: [docker-api]
```

`internal: true`는 socket-proxy의 외부 연결을 끊는다 — 그 컨테이너가 뚫려도 밖으로 나가지 못한다. worker는 두 망에 붙어 `deployhub`로 postgres와 인터넷에, `docker-api`로 socket-proxy에 닿는다. **web은 Docker API에 닿을 경로가 아예 없다** — 인터넷에 노출된 표면이기 때문이다.

격리를 실제로 확인한다. 파일을 읽어 "없더라"가 아니라 기동해서 확인한다.

```bash
# web 에서는 차단되어야 한다
docker compose exec web node -e "fetch('http://socket-proxy:2375/_ping').then(r=>console.log('!!! 도달함',r.status)).catch(e=>console.log('차단됨',e.message))"
# worker 에서는 200 이어야 한다
docker compose exec worker node -e "fetch('http://socket-proxy:2375/_ping').then(r=>console.log('도달',r.status))"
```

`.env.example`에 `DOCKER_HOST_URL=`을 추가하고 `packages/shared/src/env.ts`의 `Env`에 선택 필드로 넣는다. 없으면 Docker 수집을 건너뛴다 — 로컬 개발에서 socket-proxy 없이도 앱이 떠야 한다.

- [ ] **Step 4: 검증과 커밋**

Run: `docker compose -f docker/compose.yml config | grep -A2 published` — 80/443 외에 나오면 실패

**게이트 통과 조건:** 마이그레이션 추가만. socket-proxy에 `ports` 없고 `POST: 0`일 것.

**완료 (2026-07-27, 41fc9c8 → 병합·배포).** 격리를 로컬과 운영 양쪽에서 실측했다: `deployhub` 망 차단, `docker-api` 망 200, POST/DELETE/exec 403. `compose config` published 포트 0건. 운영 기존 9개 서비스 배포 전후 동일.

검토에서 결함 하나를 고쳤다. socket-proxy 이미지에 태그가 없어 `latest` 로 해석됐다 — 스택에서 유일하게 `docker.sock` 을 쥐는 컨테이너라 `pull` 한 번에 코드가 바뀔 수 있다. v0.5.0 다이제스트로 고정했다.

배포 중 런북 결함도 발견해 `docs/deployment.md` 에 기록했다(b20ffea). `docker compose build` 가 `profiles` 에 속한 서비스를 건너뛰어, 낡은 migrate 이미지로 돌면서 `migrations applied successfully!` 를 출력하고 테이블은 생기지 않았다. **성공 메시지가 나오는 실패**다. 이후 마이그레이션에서는 `--profile tools build migrate` 를 따로 하고 테이블 수를 직접 세라.

---

## Task 3: Vercel Collector

**Files:**
- Create: `packages/collectors/src/vercel/{index,normalize}.ts`, `normalize.test.ts`
- Create: `packages/collectors/test/fixtures/vercel-{project,deployment,env}.json`
- Create: `apps/worker/src/handlers/vercel-sync.ts`, `vercel-sync.test.ts`
- Modify: `apps/worker/src/handlers/index.ts`

**Interfaces:**

```ts
export function createVercelCollector(token: string, teamId?: string): VercelCollector;
export type VercelEnvVar = { key: string; target: string[]; type: string };
export function normalizeVercelProject(project: unknown, envVars: VercelEnvVar[]): ExternalResource;
export function normalizeVercelDeployment(deployment: unknown): ExternalDeployment;
```

`packages/collectors` 는 `@deployhub/db` 에 의존하지 않는다(package.json 의존성은 `@deployhub/shared` 와 `@octokit/rest` 뿐이다). 그러니 수집기가 `DeploymentInput` 을 반환하면 안 된다. 그 타입은 `projectId`·`componentId` 를 품는데, 그건 DB 를 조회해야 알 수 있는 값이라 수집기가 채울 수 없다. **관측과 매핑을 섞지 마라.** 수집기는 공급자가 준 것만 담고, 프로젝트 연결은 worker 핸들러가 한다.

`packages/collectors/src/types.ts` 에 다음을 추가한다:

```ts
export type ExternalDeployment = {
  /** 어느 자원의 배포인가. ExternalResource.externalId 와 맞춘다. */
  resourceExternalId: string;
  externalDeploymentId: string;
  environment: string;
  status: string;
  version?: string;
  commitSha?: string;
  imageName?: string;
  deploymentUrl?: string;
  startedAt?: string;
  completedAt?: string;
  metadata: Record<string, unknown>;
};

/** 배포 이력까지 주는 수집기. GitHub 수집기는 구현하지 않는다. */
export interface DeploymentCollector extends ProviderCollector {
  listDeployments(): Promise<ExternalDeployment[]>;
}

export type VercelCollector = DeploymentCollector;
```

`ProviderCollector` 는 **건드리지 마라.** 거기에 `listDeployments` 를 넣으면 GitHub 수집기가 쓰지도 않을 메서드를 갖게 된다. 확장 인터페이스로 나눈다.

시각은 문자열(ISO 8601)로 넘기고 `Date` 변환은 worker 핸들러에서 한다. 수집기가 `Date` 를 만들면 시간대 처리가 두 곳으로 흩어진다.

- [ ] **Step 1: 픽스처와 실패하는 테스트 작성**

**env 픽스처에 `value` 필드를 값과 함께 넣어라** — 그것을 버리는지 테스트하기 위함이다. 값에 `VERCEL_ENV_SHOULD_NOT_APPEAR` 같은 식별 가능한 문자열을 쓴다.

검증할 것:
1. `externalId`가 Vercel 프로젝트 ID, `resourceType`이 `vercel_project`
2. `metadata.framework`, `metadata.gitRepository`(`owner/name` 형태), `metadata.productionDomain`
3. **`metadata.envVars`의 각 원소가 `{key, target, type}` 뿐이다** — 키 집합을 정확히 비교한다. `target`은 정렬되어 있어야 한다(정렬하지 않으면 응답 순서가 바뀔 때마다 없던 Drift가 생긴다). `value`는 물론이고 `id`·`createdAt`·`gitBranch`·`comment`도 담지 않는다
4. **결과 전체를 `JSON.stringify`했을 때 픽스처의 env 값이 없다**
5. **허용목록 밖 필드가 `metadata`에 없다** — 예상 키 집합과 정확히 일치하는지 단언
6. 배포 정규화가 `commitSha`·`status`·`deploymentUrl`·`startedAt`을 채운다
7. 토큰이 결과나 오류 메시지에 없다

- [ ] **Step 2: 실패 확인 → 구현**

호출할 엔드포인트:

```
GET /v9/projects                      프로젝트 목록
GET /v9/projects/{id}/env             환경변수 (이름·target·type만)
GET /v6/deployments?projectId={id}    배포 이력
```

**`decrypt=true` 파라미터를 절대 쓰지 마라.** 응답에 `value` 필드가 오더라도 파싱 단계에서 즉시 버려라.

`metadata` 허용목록: `framework`, `gitRepository`, `productionDomain`, `nodeVersion`, `envVars`, `createdAt`, `updatedAt`.

`envVars`가 이름만이 아니라 `{key, target, type}`인 이유는 이 시스템이 답하려는 질문 때문이다. 이름만 있으면 `SUPABASE_URL`이 존재한다는 것까지만 안다. `target`이 있어야 production과 preview가 서로 다른 뒷단을 보는지 구분된다 — Task 5의 Drift를 환경별로 가르려면 이 값이 필요하다. `type`은 값을 읽지 않고도 암호화 여부를 표시하게 해준다. 셋 다 열거형이라 비밀값이 아니다.

**객체 단위에도 허용목록을 적용한다.** 응답을 복사한 뒤 `value`만 지우는 방식은 금지다. Vercel이 필드를 추가하면 그대로 샌다.

- [ ] **Step 3: worker 핸들러**

`vercel.sync`를 등록한다. 6시간 주기. `provider_accounts`에서 토큰을 복호화해 쓴다.

**`teamId`는 이 카드에서 전달하지 않는다.** `provider_accounts`에 넣을 자리가 없고, `name` 접두사로 추론하는 것은 추측이며(`name`은 사람이 자유롭게 적는 표시용 문자열이다), `scopes`에 얹는 것은 OAuth 권한 범위를 뜻하는 컬럼을 오염시킨다. 전용 컬럼은 M4의 Vercel 계정 등록 화면과 함께 만든다 — 지금 컬럼만 추가하면 값을 넣을 방법이 없어 영원히 `null`이다.

**다만 이것은 조용한 오답을 만든다.** 팀 토큰으로 `teamId` 없이 `/v9/projects`를 부르면 Vercel은 오류가 아니라 개인 범위 결과(대개 빈 배열)를 `200`으로 준다. 토큰도 유효하고 요청도 성공했는데 결과만 틀린 상태다.

그래서 수집 결과가 0건이면 `last_sync_at`은 정상 갱신하되 `last_error`에 짧은 진단을 남긴다 — "프로젝트 0건. 팀 계정 토큰이면 teamId 지정이 필요한데 아직 지원하지 않는다." 0건이 아니면 `null`로 되돌린다. 테스트 2건으로 고정한다.

`last_error`가 의미상 완벽한 자리는 아니다(0건은 오류가 아니라 사실일 수도 있다). 지금 사람 눈에 보이는 표면이 그것뿐이라 택한 것이고, Task 6 화면에서 제대로 표시한다.

- `resources`에 upsert (`provider='vercel'`, `resource_type='vercel_project'`)
- 사라진 자원은 `deleted_at`. **DELETE 금지**
- 배포는 `deployments`에 upsert
- `provider_accounts.last_sync_at`·`last_error` 갱신

- [ ] **Step 4: 검증과 커밋**

Run: `git grep -nE 'VERCEL_ENV_SHOULD_NOT_APPEAR' -- apps packages ':!*fixtures*'` — 매치 없어야 한다

Run: `git grep -nE 'decrypt=true|[?&]decrypt' -- apps packages` — 매치 없어야 한다

Run: `git grep -n 'decrypt' -- packages/collectors` — 매치 없어야 한다

두 번째가 본질이다. `decrypt`는 저장소의 AES-GCM 복호화 헬퍼 이름이라 `shared/crypto`·`github-sync`·`provider-view`에 이미 12곳 쓰인다. 저장소 전체에서 0건을 요구하면 달성할 수 없다. 막아야 할 것은 Vercel API의 `decrypt=true` 질의 파라미터다.

`packages/collectors`에서 0건이어야 하는 이유는 따로 있다. 수집기는 암호화된 값을 다루지 않는다 — 토큰은 이미 복호화된 문자열로 worker 핸들러에서 주입받는다. 수집기 안에 `decrypt`가 나오면 경계가 잘못 그어진 것이다.

**게이트 통과 조건:** 정규화 테스트 7건 통과. 특히 env 값 미저장, 허용목록 단언, 토큰 미노출.

---

## Task 4: Docker Collector

**이 카드의 핵심은 기능이 아니라 비밀값 차단이다.** 공용 VPS라 다른 프로젝트 DB 세 개의 자격증명이 노출 대상이다.

**Files:**
- Create: `packages/collectors/src/docker/{index,normalize}.ts`, `normalize.test.ts`
- Create: `packages/collectors/test/fixtures/docker-inspect.json`
- Create: `apps/worker/src/handlers/docker-sync.ts`, `docker-sync.test.ts`
- Modify: `apps/worker/src/handlers/index.ts`, `apps/worker/src/index.ts`

- [ ] **Step 1: 픽스처 준비**

실제 `docker inspect` 응답 형태를 담되 **`Config.Env`에 값이 있는 상태로** 만든다.

```json
{
  "Id": "3b27fe7ebf9b00000000000000000000000000000000000000000000000000000",
  "Name": "/deployhub-postgres",
  "Created": "2026-07-26T09:59:00Z",
  "Image": "sha256:abc123",
  "RestartCount": 0,
  "Config": {
    "Image": "postgres:17-alpine",
    "Env": [
      "POSTGRES_USER=deployhub",
      "POSTGRES_PASSWORD=SUPER_SECRET_SHOULD_NOT_APPEAR",
      "PATH=/usr/local/sbin:/usr/local/bin"
    ],
    "Labels": {
      "deployhub.project": "deployhub",
      "deployhub.component": "database",
      "com.docker.compose.project": "docker",
      "com.docker.compose.service": "postgres"
    },
    "Cmd": ["postgres", "-c", "password=ALSO_SECRET"],
    "Entrypoint": ["docker-entrypoint.sh"]
  },
  "State": {
    "Status": "running",
    "StartedAt": "2026-07-26T10:00:00Z",
    "Health": { "Status": "healthy" }
  },
  "Mounts": [{
    "Type": "volume", "Name": "postgres_data",
    "Source": "/var/lib/docker/volumes/postgres_data/_data",
    "Destination": "/var/lib/postgresql/data"
  }],
  "NetworkSettings": { "Networks": { "docker_deployhub": {} }, "Ports": {} }
}
```

- [ ] **Step 2: 실패하는 정규화 테스트 작성**

검증할 것:

1. `externalId`가 **전체 컨테이너 ID**, `resourceType`이 `docker_container`, `name`이 앞 슬래시를 뗀 `deployhub-postgres`

   **짧은 ID를 쓰지 않는다.** 12자 형태는 사람이 읽기 위한 표시 규약이지 식별자가 아니다. `resources.external_id`를 짧게 두면 `deployments.external_deployment_id`(전체 ID)와 같은 컨테이너를 두 이름으로 부르게 된다. 지금은 안 깨지지만 Task 5가 선언과 관측을 잇는 카드라, 나중에 두 컬럼을 조인하면 오류 없이 빈 결과가 나온다. 저장은 전체로 하고 자르는 것은 Task 6 화면에서 한다.

   `ExternalResource.externalId`·`ExternalDeployment.resourceExternalId`·`deployments.externalDeploymentId` 셋을 같은 값으로 맞추고, **두 곳이 같은지 단언하는 테스트를 둔다** — 다시 갈라지면 그때 잡힌다.
2. `status`가 `running`, `metadata.health`가 `healthy`
3. `metadata.image`가 `postgres:17-alpine`
4. `metadata.labels`에 `deployhub.project`·`deployhub.component`가 있다
5. **`metadata.envKeys`가 `['POSTGRES_USER','POSTGRES_PASSWORD','PATH']`** — 이름만
6. **결과 전체에 `SUPER_SECRET_SHOULD_NOT_APPEAR`가 없다**
7. **결과 전체에 `ALSO_SECRET`이 없다** — `Cmd`를 아예 담지 않기 때문
8. **`metadata.mounts`에 호스트 경로(`Source`)가 없다** — `{type,name,destination}`만
9. **허용목록 밖 필드가 `metadata`에 없다** — 예상 키 집합과 정확히 일치
10. `metadata.composeProject`가 `docker`, `composeService`가 `postgres`
11. `observedAt`이 ISO 8601

**6·7·8·9번이 이 카드의 존재 이유다.** 9번이 특히 중요하다 — 차단목록이 아니라 허용목록임을 강제한다.

- [ ] **Step 3: 실패 확인 → 정규화 구현**

`metadata`는 **아래 필드만** 담는다. inspect 응답을 통째로 넣지 마라.

```
image, imageId, health, createdAt, startedAt, restartCount,
labels, composeProject, composeService,
networks (이름 배열), envKeys (이름 배열),
mounts ({type,name,destination}[])
```

`Cmd`, `Entrypoint`, `Mounts[].Source`, `Config.Env`의 값 부분은 **담지 않는다.**

`envKeys`는 각 항목을 첫 `=`에서 잘라 앞부분만 취한다.

- [ ] **Step 4: Collector 구현**

`createDockerCollector(baseUrl)`가 socket-proxy에 HTTP로 접근한다.

- `testConnection()` — `GET /_ping`
- `listResources()` — `GET /containers/json?all=1` 후 각각 `GET /containers/{id}/json`

**오류 메시지에 URL 전체나 응답 본문을 넣지 마라.** 상태 코드와 컨테이너 수만 남긴다.

- [ ] **Step 5: worker 핸들러**

`docker.sync`를 등록한다. 5분 주기. `DOCKER_HOST_URL`이 없으면 조용히 건너뛴다.

- `resources`에 upsert (`provider='docker'`, `external_id`=컨테이너 ID)
- 사라진 자원은 `deleted_at`. **DELETE 금지**
- `GET /containers/{id}/stats?stream=false`로 CPU/메모리를 `container_snapshots`에 기록
- `observed_at`은 DB `now()`
- 14일보다 오래된 스냅샷 정리
- 실행 중인 컨테이너의 이미지 태그와 시작 시각을 `deployments`에 한 줄로 기록 — Vercel과 같은 방식으로 "최종 배포"를 보기 위함

  `deployments`의 유일 제약은 `(provider, external_deployment_id)`다. docker에서 이 값은 **컨테이너 ID 하나만** 쓴다. 시작 시각을 붙이지 마라.

  재시작과 재배포는 다른 사건이다. 재시작은 컨테이너 ID가 그대로이므로 같은 행이 갱신되어야 한다 — 재시작 횟수는 `container_snapshots.restart_count`가 이미 담는다. 재배포는 새 컨테이너가 뜨면서 ID가 바뀌므로 자연히 새 행이 생긴다. 시작 시각을 키에 넣으면 재시작마다 배포 이력이 한 줄씩 늘어 "최종 배포"가 무의미해진다.

  `environment`는 `deployhub.environment` 레이블을 쓰고, 없으면 `unknown`으로 둔다. 레이블이 없는 다른 프로젝트 컨테이너 9개가 여기 해당한다.

**공용 VPS이므로 다른 프로젝트 컨테이너 9개도 수집된다.** 의도된 것이다. Label이 없으면 `Unlinked`로 남는다.

**반복 조회에 상한(256개)을 둔다.** 초과하면 일부만 처리하지 말고 동기화 전체를 실패시킨다. 목록에 없는 자원에 `deleted_at`을 채우는 로직이 있으므로, 잘린 목록으로 그것을 돌리면 살아 있는 컨테이너가 삭제된 것으로 표시된다. 잘린 목록으로는 "사라졌다"를 판단할 수 없다. `last_error`에는 개수와 상한만 적고 컨테이너 이름이나 ID를 넣지 않는다.

- [ ] **Step 6: 검증과 커밋**

Run: `git grep -nE 'SUPER_SECRET|ALSO_SECRET' -- apps packages ':!*fixtures*' ':!*.test.ts'` — 매치 없어야 한다

**게이트 통과 조건:** 정규화 테스트 11건 전부 통과. 특히 값 미노출 3건과 허용목록 단언. 사라진 자원을 `DELETE`하지 않을 것.

---

## Task 5: 선언↔관측 연결과 Drift

**Files:**
- Create: `packages/db/src/queries/drift.ts`, `drift.test.ts`
- Create: `apps/web/src/lib/declared-link.ts`, `declared-link.test.ts`
- Modify: `apps/worker/src/handlers/{docker-sync,vercel-sync}.ts` (선언 기반 자동 연결)
- Modify: `apps/web/src/actions/links.ts`

**Interfaces:**

```ts
export type DriftKind =
  | 'declared_not_observed'    // manifest 에 있는데 관측 안 됨
  | 'observed_not_declared'    // 관측됐는데 manifest 에 없음
  | 'image_mismatch'           // 선언 이미지와 실행 이미지가 다름
  | 'provider_mismatch';       // 선언 provider 와 관측 provider 가 다름

export type Drift = {
  kind: DriftKind;
  projectId: string;
  componentId: string | null;
  declared: string | null;
  observed: string | null;
  detail: string;
};

export function computeDrift(db, projectId): Promise<Drift[]>;
```

- [ ] **Step 1: 선언 기반 자동 연결 테스트**

선언에 참조값이 있으면 관측 자원과 **즉시 연결**한다. 사용자가 직접 적은 값이므로 구축방안 14.2에 어긋나지 않는다.

| 선언 | 매칭 대상 | `linked_by` |
|---|---|---|
| `container: deployhub-web` | `docker_container`의 `name` | `manifest` |
| `provider: vercel` + `externalRef` | `vercel_project`의 `external_id` | `manifest` |
| Docker Label `deployhub.component` | 해당 구성요소 | `label` |

검증할 것:
- `container` 이름이 정확히 일치하면 연결된다
- 부분 일치는 연결하지 않는다 (`deployhub-web`이 `deployhub-web-old`에 붙으면 안 됨)
- 선언된 컨테이너가 관측되지 않으면 연결하지 않고 Drift를 남긴다
- 이미 `user`로 연결된 것을 자동 연결이 덮어쓰지 않는다
- Label과 manifest가 다른 구성요소를 가리키면 연결하지 않고 경고를 남긴다

마지막이 중요하다. **충돌 시 추측으로 하나를 고르지 마라.**

- [ ] **Step 2: Drift 계산 테스트**

검증할 것:
- manifest에 `container: foo`가 있는데 그런 컨테이너가 없으면 `declared_not_observed`
- 프로젝트에 연결된 컨테이너인데 manifest에 그 이름이 없으면 `observed_not_declared`
- `provider: supabase`인데 연결된 자원이 `docker_container`뿐이면 `provider_mismatch`
- 선언과 관측이 일치하면 빈 배열
- **Drift를 테이블에 저장하지 않는다** — 조회 시 계산한다(구축방안 7.5). 저장하면 낡는다

- [ ] **Step 3: 실패 확인 → 구현 → 통과 확인**

- [ ] **Step 4: 커밋**

**게이트 통과 조건:** 부분 일치 연결 없을 것. 충돌 시 자동 선택 없을 것. Drift가 파생 계산일 것.

---

## Task 6: 화면 — 뒷단과 최종 배포

**Files:**
- Create: `apps/web/src/lib/backend-view.ts`, `backend-view.test.ts`
- Modify: `apps/web/src/app/projects/[slug]/page.tsx`
- Modify: `apps/web/src/app/resources/page.tsx`
- Modify: `apps/web/src/app/page.tsx`

- [ ] **Step 1: 요약 로직 테스트** (순수 함수로 분리)

```
연결된 자원의 provider 집합 → 요약 문구
  {docker}           → 'VPS 단독'
  {vercel}           → 'Vercel'
  {docker, vercel}   → 'Vercel + VPS'
  {}                 → '미확인'      ← 추측 금지
```

선언은 있는데 관측이 없으면 `미확인 (선언: hostinger)` 형태로 **둘을 구분해 보여준다.** 선언을 사실처럼 표시하지 마라.

- [ ] **Step 2: 프로젝트 상세에 "뒷단" 섹션**

```
deployhub                                          VPS 단독
├─ web       hostinger    deployhub-web       running   deployhub:local
├─ worker    hostinger    deployhub-worker    running   deployhub:local
└─ database  self-hosted  deployhub-postgres  running   postgres:17-alpine

Drift  없음

최종 배포
  web      deployhub:local  a41d82c  2시간 전
  worker   deployhub:local  a41d82c  2시간 전
```

각 구성요소에 **선언(provider)과 관측(컨테이너 상태·이미지)을 나란히** 보여준다. Drift가 있으면 그 줄을 강조한다.

- [ ] **Step 3: Resources 화면에 provider 필터**

`docker_container`가 들어오면 41개에서 53개로 는다. provider와 resourceType으로 거를 수 있어야 한다. Unlinked 표시는 유지한다.

- [ ] **Step 4: Overview 요약 카드**

`전체 프로젝트 · 수집 저장소 · 실행 중 컨테이너 · 미연결 자원 · Drift 있는 프로젝트`

- [ ] **Step 5: 검증과 커밋**

**게이트 통과 조건:** 요약이 관측에서 도출될 것. 자원이 없으면 `미확인`이며 선언을 사실처럼 표시하지 않을 것.

---

## Self-Review

**1. 구축방안 커버리지**

| 항목 | Task |
|---|---|
| 원본 §14.3 manifest `provider`·`externalRef`·`container` | 1 |
| 7.2 관측 영역 — `deployments`, `container_snapshots` | 2 |
| 11.1 Vercel 수집 (환경변수 이름·Scope) | 3 |
| 12 Docker 수집, 12.2 socket-proxy | 2, 4 |
| 13 Docker Label 표준 매칭 | 5 |
| 7.5 Drift (파생 계산) | 5 |
| 14.2 자동 연결 금지 (추측 매칭) | 5 |
| 16.6 Unlinked 표시 | 6 |
| 6 의존성 지문 | **M3 이후** — 등록되지 않은 저장소용 |
| 11.2 Supabase · 11.3 Hostinger | **M4** |

**2. 타입 일관성**

- manifest `provider` 12종 — Task 1 정의, Task 5가 소비 ✓
- `ExternalResource` — M1b 정의, Task 3·4가 생산 ✓
- `DeploymentInput` — Task 2 정의, Task 3·4가 생산 ✓
- `linked_by` — M1a 정의. Task 5가 `'manifest'`·`'label'` 사용 ✓
- `Drift` — Task 5 정의, Task 6이 소비 ✓

**3. 위험 지점**

- **Docker `Config.Env`의 값.** 실측 확인. 공용 VPS라 다른 프로젝트 DB 세 개가 대상이다. 허용목록 + 값 미포함 단언 + `git grep` 삼중 방어.
- **`Cmd`/`Entrypoint`.** 인자에 비밀값이 들어간다. 아예 담지 않는다.
- **`Mounts[].Source`.** 호스트 경로가 드러난다. 볼륨 이름과 destination만.
- **Vercel `decrypt=true`.** 쓰면 값이 온다. 금지.
- **공용 VPS의 남의 컨테이너.** 이름 유사도로 연결하면 남의 것이 우리 프로젝트에 붙는다. **정확 일치와 Label만 신뢰한다.**
- **운영 마이그레이션 2회** (Task 1, Task 2). 각각 추가만이어야 한다.
- **`provider`를 열린 문자열로 두면** 오타가 조용히 통과해 자동 연결이 실패한다. 목록으로 제한한다.

**4. M1에서 배운 것의 반영**

- 허용목록 원칙을 Global Constraints로 승격
- 모든 Zod 문자열 `.trim()` (M1b `[ worker]` 사건)
- 시간은 DB 시계만 (M1a Task 3)
- 사라진 자원은 `deleted_at`, `DELETE` 금지
- `filesModified`를 지시와 대조 — M1c에서 이걸 안 해 미완성을 병합했다
- 실제로 실행해보고 검증 — 테스트 통과가 대역으로만 검증된 것일 수 있다

---

## Execution

orca orchestration + codex 위임. Task 1 → 2 → 3 → 4 → 5 → 6 순서.

Task 1이 5의 선행, Task 2가 3·4의 선행, Task 3·4가 5의 선행, Task 5가 6의 선행이므로 병렬화하지 않는다.

**Task 1·2 병합 후 각각 운영에 마이그레이션을 적용한다.** Task 2에서는 socket-proxy가 새로 뜨므로 다른 서비스에 영향이 없는지 확인한다.

**Task 4 병합 후 운영에서 실제 수집을 한 번 돌린다.** 공용 VPS의 12개 컨테이너가 들어오는지, 그리고 **DB에 비밀값이 없는지**를 직접 확인한다. 이것이 M2에서 가장 중요한 검증이다.

```sql
-- 이 쿼리가 0을 반환해야 한다
select count(*) from resources
where metadata::text ~ '(PASSWORD|SECRET|TOKEN|KEY)=[^"]';
```
