# DeployHub M2 (뒷단 파악) Implementation Plan

> **For agentic workers:** orca orchestration으로 codex 워커에게 카드 단위 위임된다. 각 Task는 격리 worktree에서 수행하고, 검증 명령이 모두 통과한 뒤 Claude의 설계 부합 검토를 거쳐 main에 병합한다.

**Goal:** 구축방안 1.1의 질문 ①에 답한다 — **등록된 각 프로젝트가 어떤 서비스 위에서 구동되고 있는가.** VPS Docker인지, Vercel인지, DB가 Supabase인지 자체 PostgreSQL인지, 어떤 외부 API에 의존하는지를 **선언이 아니라 관측**으로 채운다.

**Architecture:** 두 Collector(Docker·Vercel)가 실행 중인 실체를 수집하고, `packages/fingerprint`가 **환경변수 이름**과 **의존성 목록** 두 신호로 뒷단 서비스를 추론한다. 저장소를 축으로 GitHub·Vercel·Docker 자원을 서로 잇는다.

**Tech Stack:** 기존 스택. **새 외부 의존성 없음** — Docker는 socket-proxy에 HTTP로, Vercel은 REST API에 `fetch`로 접근한다.

**선행 문서:** `docs/superpowers/specs/2026-07-26-deployhub-구축방안.md` (§6 의존성 지문, §7.2 관측 영역), M1a·M1b·M1c 계획서

---

## 지금 시스템이 답하지 못하는 것

현재 운영 DB 상태다.

| 아는 것 | 출처 |
|---|---|
| `deployhub`의 구성요소 3개와 framework/runtime | **사람이 선언** (manifest) |
| GitHub 저장소 41개 | 관측 |
| web·worker가 `gnghkim/DeployHub`를 씀 | 사람이 연결 |

`resources`에는 `github_repository` 41개뿐이다. **`docker_container`·`vercel_project`·`supabase_project`가 0개**다. 그래서 "DeployHub가 VPS 단독으로 돈다"는 것도, "database가 Supabase가 아니라 자체 컨테이너다"라는 것도 시스템은 **모른다.** manifest에 적힌 `runtime: postgresql`은 사람이 쓴 선언일 뿐 확인된 사실이 아니다.

M2가 이 간극을 메운다.

---

## 배포 환경의 제약 (실측)

**공용 VPS다.** 12개 컨테이너가 돌고 그중 9개는 다른 프로젝트다.

```
linkvault-worker-1   bmsimul-bmsimul-1    yield-api-1
yield-postgres-1     workwiki-backend     workwiki-postgres
ktgo-postgres        reporthub-reporthub-1  caddy-caddy-1
deployhub-web        deployhub-worker     deployhub-postgres
```

Docker Collector는 이 전부를 보게 된다. 그것 자체는 의도된 것이다 — 구축방안 16.6이 Label 없는 컨테이너를 `Unlinked`로 표시하라고 했다.

**그런데 `docker inspect`는 환경변수 값을 그대로 반환한다.** 실측으로 확인했다.

```
$ docker inspect deployhub-postgres --format '{{range .Config.Env}}{{.}}{{"\n"}}{{end}}'
POSTGRES_USER=deployhub
POSTGRES_PASSWORD=<실제 값>
POSTGRES_DB=deployhub
```

순진하게 수집하면 **다른 프로젝트 DB 세 개의 비밀번호가 우리 DB에 평문으로 들어간다.** GitHub 때보다 훨씬 위험하다 — 값이 API 응답에 기본으로 들어 있고, 우리 것이 아닌 남의 자격증명이다.

**이것이 M2의 첫 번째 규칙이다.** Task 3의 절대 규칙으로 못박는다.

---

## Global Constraints

M1a·M1b·M1c의 Global Constraints를 그대로 승계하고 아래를 더한다.

- **관측 데이터는 허용목록(allowlist)으로 구성한다.** API 응답을 통째로 `metadata`에 넣지 마라. 필요한 필드만 명시적으로 골라 담는다. 차단목록(denylist)은 새 필드가 추가될 때 뚫린다.
- **환경변수는 이름만 저장한다.** 값은 어떤 경로로도 저장·로그·응답에 남기지 않는다. Docker `Config.Env`, Vercel env API 둘 다 해당한다.
- **관측 이력을 지우지 않는다.** 사라진 자원은 `deleted_at`을 채운다(구축방안 7.2).
- **시간은 DB 시계만 쓴다.** worker가 앱 시계로 만든 시각을 DB 시각과 비교하는 경로를 만들지 마라(M1a Task 3).
- **모든 Zod 문자열에 `.trim()`.**
- **새 외부 의존성을 추가하지 않는다.** Docker는 socket-proxy에 HTTP, Vercel은 REST에 `fetch`로 충분하다.
- **`docs/`는 각 Task의 산출물이 아니다.**

---

## 구축방안 대비 결정

| 항목 | 구축방안 | M2 결정 | 근거 |
|---|---|---|---|
| Docker 접근 | 12절이 별도 collector 컨테이너 제안 | **worker가 socket-proxy에 HTTP 호출** | 구축방안 4절에서 이미 확정한 구조. socket-proxy가 읽기 전용 경계이므로 컨테이너를 하나 더 두면 경계를 두 번 긋는 것 |
| Docker 라이브러리 | 언급 없음 | **`fetch` 직접** | socket-proxy가 HTTP를 노출한다. `dockerode`를 넣을 이유가 없다 |
| Vercel SDK | 언급 없음 | **`fetch` 직접** | 필요한 엔드포인트가 5개 미만이다 |
| `container_snapshots` | 7.2에 있음 | **M2 포함** | CPU/메모리 시계열. 보존 14일 |
| `deployments` | 7.2에 있음 | **M2 포함** | Vercel 배포 이력과 Docker 이미지 태그를 한 줄로 보는 데 필요 |
| Hostinger VPS 자원 | M4 | **M2 제외** | CPU/디스크는 M3 모니터링의 관심사다. M2는 "무엇 위에서 도는가"에 집중 |

---

## Task 1: 스키마 확장과 socket-proxy

**Files:**
- Create: `packages/db/src/schema/observations.ts` (`deployments`, `containerSnapshots`)
- Create: `drizzle/0004_*.sql`
- Create: `packages/db/src/queries/observations.ts`, `observations.test.ts`
- Modify: `packages/db/src/schema/index.ts`, `packages/db/src/index.ts`
- Modify: `docker/compose.yml` (socket-proxy 추가)
- Modify: `.env.example`

**Interfaces:**
- Produces:

```ts
deployments:        id, project_id(null), component_id(null), provider, environment,
                    version, commit_sha, image_name, external_deployment_id, status,
                    deployment_url, started_at, completed_at, metadata, created_at
containerSnapshots: id, resource_id, cpu_pct, mem_bytes, restart_count, observed_at

export function recordSnapshot(db, rows: SnapshotInput[]): Promise<void>;
export function pruneSnapshots(db, olderThanDays: number): Promise<number>;
export function upsertDeployment(db, input: DeploymentInput): Promise<void>;
```

- [ ] **Step 1: 실패하는 테스트 작성** (구현보다 먼저)

검증할 것:
- `containerSnapshots`가 같은 `resource_id`에 여러 행을 누적한다 (갱신이 아니라 시계열)
- `pruneSnapshots(14)`가 14일보다 오래된 행만 지운다
- `observed_at` 기본값이 DB `now()`다 — 앱에서 넣은 시각이 아님을 단언
- `upsertDeployment`가 `(provider, external_deployment_id)` 충돌 시 갱신한다
- `deployments.project_id`가 null이어도 저장된다 (아직 프로젝트에 안 묶인 배포)
- 자원이 삭제되면 스냅샷도 함께 삭제된다 (`on delete cascade`)

- [ ] **Step 2: 실패 확인 → 스키마 구현**

`deployments`의 unique는 `(provider, external_deployment_id)`. Docker는 외부 배포 ID가 없으므로 `container_id + image_id` 조합을 넣는다.

`containerSnapshots`에 `(resource_id, observed_at)` 인덱스를 만든다. 조회가 항상 자원별 시간 범위이기 때문이다.

- [ ] **Step 3: 마이그레이션 생성**

Run: `pnpm --filter @deployhub/db exec drizzle-kit generate`

**생성된 SQL을 반드시 읽어라.** 운영 DB에 적용된다. 기존 10개 테이블을 `ALTER`/`DROP`하는 문장이 있으면 멈추고 보고하라. 이 Task는 테이블 2개를 **추가**할 뿐이다.

- [ ] **Step 4: compose에 socket-proxy 추가**

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

**`ports`를 넣지 마라.** worker만 내부망에서 접근한다. `POST: 0`이 생성·삭제·exec를 전면 차단한다(구축방안 12.2).

`.env.example`에 `DOCKER_HOST_URL=`을 추가한다. 값은 `http://socket-proxy:2375`이며 worker가 쓴다.

- [ ] **Step 5: 검증과 커밋**

Run: `pnpm typecheck && pnpm vitest run`
Run: `docker compose -f docker/compose.yml config | grep -A2 published` — 여전히 80/443만 나오거나 비어 있어야 한다

**게이트 통과 조건:** 마이그레이션이 추가만 할 것. socket-proxy에 `ports` 없을 것. `POST: 0`일 것.

---

## Task 2: packages/fingerprint

이 카드가 "뒷단이 무엇인가"에 답하는 엔진이다. 순수 함수이므로 네트워크 없이 결정적으로 테스트된다.

**Files:**
- Create: `packages/fingerprint/{package.json,tsconfig.json}`
- Create: `packages/fingerprint/src/{index,types,rules,match}.ts`
- Create: `packages/fingerprint/src/{rules,match}.test.ts`

**Interfaces:**

```ts
export type Signal = {
  envKeys: string[];        // 값이 아니라 이름만
  dependencies: string[];   // package.json / requirements.txt 등에서 온 패키지명
};

export type BackendKind =
  | 'database' | 'cache' | 'queue' | 'storage'
  | 'authentication' | 'monitoring' | 'external_api';

export type Rule = {
  id: string;
  label: string;
  kind: BackendKind;
  provider?: string;
  envPatterns: RegExp[];
  dependencies: string[];
};

export type Finding = {
  ruleId: string;
  label: string;
  kind: BackendKind;
  provider?: string;
  confidence: 'detected' | 'inferred';
  evidence: string[];       // 어떤 신호가 맞았는지
};

export function fingerprint(signal: Signal, rules?: Rule[]): Finding[];
export const DEFAULT_RULES: Rule[];
```

- [ ] **Step 1: 실패하는 매칭 테스트 작성**

```ts
import { describe, expect, it } from 'vitest';
import { fingerprint } from './match';

describe('fingerprint', () => {
  it('두 신호가 모두 맞으면 detected 다', () => {
    const [f] = fingerprint({
      envKeys: ['SUPABASE_URL', 'SUPABASE_ANON_KEY'],
      dependencies: ['@supabase/supabase-js'],
    });
    expect(f?.ruleId).toBe('supabase');
    expect(f?.confidence).toBe('detected');
    expect(f?.evidence).toEqual(expect.arrayContaining([
      expect.stringContaining('SUPABASE_URL'),
      expect.stringContaining('@supabase/supabase-js'),
    ]));
  });

  it('환경변수만 맞으면 inferred 다', () => {
    const [f] = fingerprint({ envKeys: ['SUPABASE_URL'], dependencies: [] });
    expect(f?.confidence).toBe('inferred');
  });

  it('의존성만 맞아도 inferred 다', () => {
    const [f] = fingerprint({ envKeys: [], dependencies: ['@supabase/supabase-js'] });
    expect(f?.confidence).toBe('inferred');
  });

  it('아무것도 안 맞으면 빈 배열이다', () => {
    expect(fingerprint({ envKeys: ['FOO'], dependencies: ['left-pad'] })).toEqual([]);
  });

  it('DATABASE_URL 과 drizzle-orm 으로 자체 PostgreSQL 을 detected 한다', () => {
    const found = fingerprint({
      envKeys: ['DATABASE_URL', 'POSTGRES_PASSWORD'],
      dependencies: ['drizzle-orm', 'pg'],
    });
    const pg = found.find((f) => f.ruleId === 'postgresql');
    expect(pg?.confidence).toBe('detected');
    expect(pg?.kind).toBe('database');
  });

  it('Supabase 와 자체 PostgreSQL 을 동시에 보고할 수 있다', () => {
    const found = fingerprint({
      envKeys: ['SUPABASE_URL', 'DATABASE_URL'],
      dependencies: ['@supabase/supabase-js', 'pg'],
    });
    expect(found.map((f) => f.ruleId).sort()).toEqual(['postgresql', 'supabase']);
  });

  it('환경변수 이름 매칭은 정확 일치 또는 접두사 규칙만 쓴다', () => {
    // MY_SUPABASE_URL_BACKUP 같은 것을 잡으면 안 된다
    expect(fingerprint({ envKeys: ['MY_SUPABASE_URL_BACKUP'], dependencies: [] })).toEqual([]);
  });

  it('의존성 매칭은 정확 일치만 한다', () => {
    expect(fingerprint({ envKeys: [], dependencies: ['pg-boss'] }).some((f) => f.ruleId === 'postgresql')).toBe(false);
  });

  it('결과가 결정적이다 — 같은 입력에 같은 순서', () => {
    const s = { envKeys: ['DATABASE_URL', 'SUPABASE_URL'], dependencies: [] };
    expect(fingerprint(s)).toEqual(fingerprint(s));
  });

  it('입력에 값이 섞여 들어와도 값을 evidence 에 담지 않는다', () => {
    // envKeys 에 실수로 'KEY=value' 형태가 들어온 경우
    const found = fingerprint({ envKeys: ['SUPABASE_URL=https://secret.example'], dependencies: [] });
    expect(JSON.stringify(found)).not.toContain('secret.example');
  });
});
```

마지막 두 테스트가 중요하다. 부분 일치를 허용하면 오탐이 쌓이고(구축방안 R3), evidence에 값이 섞이면 비밀값이 화면에 뜬다.

- [ ] **Step 2: 실패 확인 → 규칙과 매처 구현**

`rules.ts`의 초기 규칙 집합. 데이터로 분리해 두어 나중에 추가하기 쉽게 한다.

| id | label | kind | envPatterns | dependencies |
|---|---|---|---|---|
| `supabase` | Supabase | database | `^SUPABASE_URL$`, `^SUPABASE_ANON_KEY$`, `^NEXT_PUBLIC_SUPABASE_` | `@supabase/supabase-js` |
| `postgresql` | PostgreSQL | database | `^DATABASE_URL$`, `^POSTGRES_(USER\|PASSWORD\|DB)$` | `pg`, `drizzle-orm`, `prisma`, `postgres` |
| `mysql` | MySQL | database | `^MYSQL_(USER\|PASSWORD\|DATABASE)$` | `mysql2` |
| `mongodb` | MongoDB | database | `^MONGO(DB)?_URI$` | `mongodb`, `mongoose` |
| `redis` | Redis | cache | `^REDIS_URL$`, `^UPSTASH_REDIS_` | `ioredis`, `redis`, `@upstash/redis` |
| `s3` | S3 호환 스토리지 | storage | `^AWS_(ACCESS_KEY_ID\|S3_BUCKET)$`, `^R2_` | `@aws-sdk/client-s3` |
| `vercel-blob` | Vercel Blob | storage | `^BLOB_READ_WRITE_TOKEN$` | `@vercel/blob` |
| `nextauth` | Auth.js | authentication | `^AUTH_SECRET$`, `^NEXTAUTH_` | `next-auth` |
| `stripe` | Stripe | external_api | `^STRIPE_SECRET_KEY$` | `stripe` |
| `resend` | Resend | external_api | `^RESEND_API_KEY$` | `resend` |
| `sentry` | Sentry | monitoring | `^SENTRY_DSN$` | `@sentry/node`, `@sentry/nextjs` |
| `openai` | OpenAI | external_api | `^OPENAI_API_KEY$` | `openai` |
| `anthropic` | Anthropic | external_api | `^ANTHROPIC_API_KEY$` | `@anthropic-ai/sdk` |

**환경변수 이름 매칭은 정규식 전체 일치(`^...$`)이거나 명시적 접두사(`^PREFIX_`)만 쓴다.** 부분 문자열 검색을 하지 마라.

`fingerprint()`는 입력 `envKeys`에서 `=`가 나타나면 **그 앞부분만** 취해 정규화한다. 방어적으로 값이 섞여 들어와도 evidence에 남지 않게 한다.

결과는 `ruleId` 사전순으로 정렬해 결정적으로 만든다.

- [ ] **Step 3: 통과 확인 → 커밋**

**게이트 통과 조건:** 매칭 테스트 10건 통과. 부분 일치 미허용, evidence에 값 미포함이 반드시 통과할 것.

---

## Task 3: Docker Collector

**이 카드의 핵심은 기능이 아니라 비밀값 차단이다.**

**Files:**
- Create: `packages/collectors/src/docker/{index,normalize}.ts`, `normalize.test.ts`
- Create: `packages/collectors/test/fixtures/docker-inspect.json`
- Create: `apps/worker/src/handlers/docker-sync.ts`, `docker-sync.test.ts`
- Modify: `apps/worker/src/handlers/index.ts`, `apps/worker/src/index.ts`
- Modify: `packages/shared/src/env.ts` (`DOCKER_HOST_URL`)

**Interfaces:**

```ts
export function createDockerCollector(baseUrl: string): ProviderCollector;
export function normalizeContainer(inspect: unknown): ExternalResource;
```

- [ ] **Step 1: 픽스처 준비**

`docker-inspect.json`에 실제 `docker inspect` 응답 형태를 담되, **`Config.Env`에 값이 있는 상태로** 만든다. 예:

```json
{
  "Id": "3b27fe7ebf9b0000000000000000000000000000000000000000000000000000",
  "Name": "/deployhub-postgres",
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
      "com.docker.compose.project": "docker"
    },
    "Cmd": ["postgres", "-c", "password=ALSO_SECRET"]
  },
  "State": { "Status": "running", "StartedAt": "2026-07-26T10:00:00Z", "Health": { "Status": "healthy" } },
  "RestartCount": 0,
  "Image": "sha256:abc123",
  "Created": "2026-07-26T09:59:00Z",
  "Mounts": [{ "Type": "volume", "Name": "postgres_data", "Source": "/var/lib/docker/volumes/postgres_data/_data", "Destination": "/var/lib/postgresql/data" }],
  "NetworkSettings": { "Networks": { "docker_deployhub": {} }, "Ports": {} }
}
```

- [ ] **Step 2: 실패하는 정규화 테스트 작성**

검증할 것:

1. `externalId`가 컨테이너 ID(짧은 형태), `resourceType`이 `docker_container`, `name`이 앞 슬래시를 뗀 이름
2. `status`가 `running`, `metadata.health`가 `healthy`
3. `metadata.image`가 `postgres:17-alpine`, `metadata.labels`에 `deployhub.project`가 있음
4. **`metadata.envKeys`가 이름만 담는다** — `['POSTGRES_USER','POSTGRES_PASSWORD','PATH']`
5. **결과 전체를 `JSON.stringify`했을 때 `SUPER_SECRET_SHOULD_NOT_APPEAR`가 없다**
6. **`ALSO_SECRET`도 없다** — `Cmd`를 아예 담지 않기 때문
7. `metadata.mounts`에 볼륨 이름과 destination만 있고 **호스트 경로(`Source`)가 없다**
8. `metadata.composeProject`가 `docker`
9. 허용목록 밖 필드가 `metadata`에 없다 — 예상 키 집합과 정확히 일치하는지 단언
10. `observedAt`이 ISO 8601

**5·6·7·9번이 이 카드의 존재 이유다.** 9번은 특히 중요하다 — 차단목록이 아니라 허용목록임을 강제한다.

- [ ] **Step 3: 실패 확인 → 정규화 구현**

`metadata`는 **아래 필드만** 담는다. inspect 응답을 통째로 넣지 마라.

```
image, imageId, health, createdAt, startedAt, restartCount,
labels, composeProject, composeService,
networks (이름 배열), envKeys (이름 배열), mounts ({type,name,destination}[])
```

`Cmd`, `Entrypoint`, `Mounts[].Source`, `Config.Env`의 값 부분은 **담지 않는다.**

`envKeys`는 `Config.Env`의 각 항목을 첫 `=`에서 잘라 앞부분만 취한다.

- [ ] **Step 4: Collector 구현**

`createDockerCollector(baseUrl)`는 socket-proxy에 HTTP로 접근한다.

- `testConnection()` — `GET /_ping`
- `listResources()` — `GET /containers/json?all=1`로 목록, 각각 `GET /containers/{id}/json`으로 상세를 받아 정규화

**오류 메시지에 URL 전체나 응답 본문을 그대로 넣지 마라.** 상태 코드와 컨테이너 수만 남긴다.

- [ ] **Step 5: worker 핸들러**

`docker.sync` 핸들러를 등록한다. 5분 주기.

- `resources`에 upsert (`provider='docker'`, `external_id`=컨테이너 ID)
- 이번 수집에서 사라진 `docker` 자원은 `deleted_at`을 채운다. **DELETE 하지 마라**
- `container_snapshots`에 CPU/메모리를 기록한다 — `GET /containers/{id}/stats?stream=false`
- `observed_at`은 DB `now()`를 쓴다
- 14일보다 오래된 스냅샷을 정리한다

**공용 VPS이므로 다른 프로젝트 컨테이너 9개도 수집된다.** 이것은 의도된 것이다. Label이 없으면 `Unlinked`로 남는다(구축방안 16.6).

- [ ] **Step 6: 검증과 커밋**

Run: `pnpm typecheck && pnpm vitest run`
Run: `git grep -nE 'SUPER_SECRET|ALSO_SECRET' -- apps packages ':!*fixtures*' ':!*.test.ts'` — 매치 없어야 한다

**게이트 통과 조건:** 정규화 테스트 10건 전부 통과. 특히 값 미노출 3건과 허용목록 단언. 사라진 자원을 `DELETE`하지 않을 것.

---

## Task 4: Vercel Collector

**Files:**
- Create: `packages/collectors/src/vercel/{index,normalize}.ts`, `normalize.test.ts`
- Create: `packages/collectors/test/fixtures/vercel-{project,deployment,env}.json`
- Create: `apps/worker/src/handlers/vercel-sync.ts`, `vercel-sync.test.ts`
- Modify: `apps/worker/src/handlers/index.ts`

**Interfaces:**

```ts
export function createVercelCollector(token: string, teamId?: string): ProviderCollector;
export function normalizeVercelProject(project: unknown, envKeys: string[]): ExternalResource;
export function normalizeVercelDeployment(deployment: unknown): DeploymentInput;
```

- [ ] **Step 1: 픽스처와 실패하는 테스트 작성**

Vercel API 응답 형태를 픽스처로 둔다. **env 픽스처에는 `value` 필드가 값과 함께 들어 있는 상태로** 만든다 — 그것을 버리는지 테스트하기 위함이다.

검증할 것:
1. `externalId`가 Vercel 프로젝트 ID, `resourceType`이 `vercel_project`
2. `metadata.framework`, `metadata.gitRepository`(`owner/name` 형태)
3. `metadata.productionDomain`
4. **`metadata.envKeys`가 이름만** — `value`가 결과에 없음
5. **결과 전체에 픽스처의 env 값 문자열이 없음**
6. 배포 정규화가 `commit_sha`, `status`, `deployment_url`, `started_at`을 채움
7. 허용목록 밖 필드가 `metadata`에 없음
8. 토큰이 결과나 오류 메시지에 없음

- [ ] **Step 2: 실패 확인 → 구현**

호출할 엔드포인트:

```
GET /v9/projects                      프로젝트 목록
GET /v9/projects/{id}/env             환경변수 (이름·target·type만 취함)
GET /v6/deployments?projectId={id}    배포 이력 (최근 것만)
```

**`GET /v9/projects/{id}/env`는 기본적으로 값을 복호화하지 않지만, 응답에 `value` 필드가 올 수 있다. 파싱 단계에서 즉시 버려라.** `decrypt=true` 파라미터를 절대 쓰지 마라.

`metadata` 허용목록: `framework`, `gitRepository`, `productionDomain`, `nodeVersion`, `envKeys`, `createdAt`, `updatedAt`.

- [ ] **Step 3: worker 핸들러**

`vercel.sync`를 등록한다. 6시간 주기. `provider_accounts`에서 토큰을 복호화해 쓴다.

배포는 `deployments`에 upsert한다. Docker 쪽도 마찬가지로 컨테이너의 이미지 태그와 시작 시각을 `deployments`에 한 줄로 기록해 **"최종 배포"를 두 Provider에서 같은 방식으로 볼 수 있게** 한다.

- [ ] **Step 4: 검증과 커밋**

**게이트 통과 조건:** 정규화 테스트 8건 통과. 특히 env 값 미저장과 토큰 미노출. `decrypt=true`를 쓰지 않을 것.

---

## Task 5: 지문 적용과 자원 연결

**Files:**
- Modify: `packages/collectors/src/github/{index,normalize}.ts` (package.json 수집)
- Create: `apps/worker/src/handlers/fingerprint-sync.ts`, 테스트
- Create: `packages/db/src/queries/fingerprint.ts`, 테스트
- Modify: `apps/web/src/lib/matcher.ts` (Docker Label 매칭 추가)
- Modify: `apps/web/src/actions/links.ts`

**Interfaces:**

```ts
export type BackendFinding = Finding & { componentId: string | null; projectId: string };
export function listProjectSignals(db, projectId): Promise<Signal>;
export function applyFingerprint(db, projectId): Promise<BackendFinding[]>;
```

- [ ] **Step 1: GitHub Collector가 의존성을 수집하도록 확장**

`GET /repos/{owner}/{repo}/contents/package.json`으로 루트 `package.json`을 읽는다. 없으면 `requirements.txt`, `pyproject.toml`을 순서대로 시도한다. 셋 다 없으면 빈 배열.

**`dependencies`와 `devDependencies`의 키만 취한다.** 버전 문자열은 evidence에 쓰되 저장은 이름 위주로 한다.

`metadata.dependencies`에 담는다. 여기에도 허용목록 원칙을 적용해 `package.json` 전체를 넣지 마라 — `scripts`에 비밀값이 들어 있는 경우가 있다.

Rate limit 주의: 저장소 41개 × 파일 조회. ETag 조건부 요청을 쓰고, 실패해도 전체 동기화를 중단하지 마라.

- [ ] **Step 2: 신호 수집 테스트**

`listProjectSignals(db, projectId)`가 아래를 합쳐 하나의 `Signal`을 만든다.

```
envKeys       ← 연결된 docker_container 의 metadata.envKeys
              + 연결된 vercel_project 의 metadata.envKeys
dependencies  ← 연결된 github_repository 의 metadata.dependencies
```

검증할 것:
- 연결된 자원이 없으면 빈 신호
- 여러 자원의 신호가 합쳐지고 중복이 제거됨
- **값이 섞여 들어오지 않음** — 자원 metadata에 값이 없으므로 당연하지만 회귀 방지로 단언

- [ ] **Step 3: 지문 적용**

`applyFingerprint(db, projectId)`가 `Signal`을 `fingerprint()`에 넘겨 `Finding[]`을 얻고, 각 finding을 **구성요소 제안**으로 만든다.

**자동으로 `components`를 만들지 마라.** 구축방안 6.3의 원칙이다. 화면에 제안으로 띄우고 사람이 확인한다. `detected`는 강조 없이, `inferred`는 강조해서 보여준다.

이미 같은 `kind`+`provider`의 구성요소가 있으면 제안하지 않는다.

- [ ] **Step 4: Docker Label 매칭**

`deployhub.project`와 `deployhub.component` 라벨이 있는 컨테이너는 해당 프로젝트·구성요소에 **즉시 연결**한다(`linked_by='label'`). 사용자가 직접 적은 선언이므로 구축방안 14.2에 어긋나지 않는다.

라벨이 없으면 연결하지 않는다. 이름 유사도로 추측하지 마라 — 공용 VPS라 남의 컨테이너가 우리 프로젝트에 잘못 붙을 수 있다.

검증할 것:
- 라벨이 있으면 `linked_by='label'`로 연결
- 라벨의 project/component가 실제로 존재하지 않으면 연결하지 않고 경고를 남김
- 라벨 없는 컨테이너는 Unlinked로 남음
- 이미 `user`로 연결된 것을 `label`이 덮어쓰지 않음

- [ ] **Step 5: 검증과 커밋**

**게이트 통과 조건:** 사람 확인 없이 `components`가 생기지 않을 것. 라벨 없는 컨테이너가 자동 연결되지 않을 것.

---

## Task 6: 화면 — 뒷단과 최종 배포

**Files:**
- Modify: `apps/web/src/app/projects/[slug]/page.tsx`
- Modify: `apps/web/src/app/resources/page.tsx`
- Modify: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/lib/backend-view.ts`, 테스트

- [ ] **Step 1: 프로젝트 상세에 "뒷단" 섹션**

이 화면이 사용자의 질문에 답한다.

```
deployhub                                          VPS 단독
├─ web       docker_container deployhub-web        running
├─ worker    docker_container deployhub-worker     running
└─ database  docker_container deployhub-postgres   running · postgres:17-alpine

뒷단 서비스
  PostgreSQL      database  detected   DATABASE_URL + drizzle-orm, pg
  Auth.js         auth      detected   AUTH_SECRET + next-auth

최종 배포
  web      deployhub:local   a41d82c   2시간 전
  worker   deployhub:local   a41d82c   2시간 전
```

**"VPS 단독" 같은 요약 문구는 관측에서 도출한다.** 연결된 자원의 provider 집합으로 정한다 — `docker`만 있으면 "VPS 단독", `vercel`만 있으면 "Vercel", 둘 다면 "Vercel + VPS". 자원이 없으면 "미확인"이며 추측하지 않는다.

- [ ] **Step 2: 요약 로직 테스트**

`backend-view.ts`의 순수 함수로 분리해 테스트한다.

- `docker`만 → `VPS 단독`
- `vercel`만 → `Vercel`
- 둘 다 → `Vercel + VPS`
- 없음 → `미확인` (추측 금지)
- `supabase` 포함 → 목록에 포함

- [ ] **Step 3: Resources 화면에 provider 필터**

`docker_container`가 들어오면 목록이 41개에서 53개로 늘어난다. provider와 resourceType으로 거를 수 있어야 한다. Unlinked 표시는 그대로 유지한다.

- [ ] **Step 4: Overview 요약 카드**

`전체 프로젝트 · 수집 저장소 · 실행 중 컨테이너 · 미연결 자원 · 최근 24시간 배포`

- [ ] **Step 5: 검증과 커밋**

Run: `pnpm typecheck && pnpm vitest run && pnpm --filter web build`

**게이트 통과 조건:** 요약이 관측에서 도출될 것. 자원이 없을 때 "미확인"이고 추측하지 않을 것.

---

## Self-Review

**1. 구축방안 커버리지**

| 구축방안 항목 | Task |
|---|---|
| 6 의존성 지문 (환경변수 이름 + 의존성) | 2, 5 |
| 6.3 신뢰도와 제안 (자동 생성 금지) | 2, 5 |
| 7.2 관측 영역 — `deployments`, `container_snapshots` | 1 |
| 12 Docker 수집, 12.2 socket-proxy | 1, 3 |
| 13 Docker Label 표준 매칭 | 5 |
| 11.1 Vercel 수집 (환경변수 이름·Scope) | 4 |
| 14.2 자동 연결 금지 | 5 |
| 16.6 Unlinked 표시 | 5, 6 |
| 11.2 Supabase · 11.3 Hostinger | **M4** |

**2. 타입 일관성**

- `Signal`/`Finding` — Task 2 정의, Task 5가 소비 ✓
- `ExternalResource` — M1b Task 4 정의, Task 3·4가 생산 ✓
- `DeploymentInput` — Task 1 정의, Task 3·4가 생산 ✓
- `linked_by` — M1a 정의. Task 5가 `'label'` 사용 ✓

**3. 위험 지점**

- **Docker `Config.Env`의 값.** 실측으로 확인했다. 공용 VPS라 다른 프로젝트 DB 세 개의 비밀번호가 노출 대상이다. 허용목록 + 값 미포함 단언 + `git grep`으로 삼중 방어한다.
- **`Cmd`/`Entrypoint`.** 인자에 비밀값이 들어가는 경우가 있다. 아예 담지 않는다.
- **`Mounts[].Source`.** 호스트 경로가 드러난다. 볼륨 이름과 destination만 담는다.
- **Vercel `decrypt=true`.** 쓰면 값이 온다. 금지한다.
- **`package.json` 통째 저장.** `scripts`에 비밀값이 있는 경우가 있다. 의존성 키만 취한다.
- **GitHub rate limit.** 저장소 41개 × 파일 조회. ETag 조건부 요청, 실패해도 전체 중단 금지.
- **공용 VPS의 남의 컨테이너.** 이름 유사도로 연결하면 남의 것이 우리 프로젝트에 붙는다. Label만 신뢰한다.
- **운영 마이그레이션.** 테이블 2개 추가뿐이어야 한다.

**4. M1에서 배운 것의 반영**

- 허용목록 원칙을 Global Constraints로 승격 — M1b Task 4에서 차단목록으로 했다면 새 필드가 뚫렸을 것이다
- 모든 Zod 문자열 `.trim()` (M1b `[ worker]` 사건)
- 시간은 DB 시계만 (M1a Task 3 시계 결함)
- 사라진 자원은 `deleted_at`, `DELETE` 금지 (M1b Task 4)
- 새 라우트를 추가하면 미들웨어 matcher를 기동해서 확인 — M2에는 새 공개 라우트가 없으므로 해당 없음
- `filesModified`를 지시와 대조 — M1c에서 이걸 안 해 미완성을 병합했다

---

## Execution

orca orchestration + codex 위임. Task 1 → 2 → 3 → 4 → 5 → 6 순서.

Task 1이 3·4의 선행, Task 2가 5의 선행, Task 3·4가 5의 선행, Task 5가 6의 선행이므로 병렬화하지 않는다.

**Task 1 병합 후 운영 서버에 마이그레이션과 socket-proxy를 적용한다.** socket-proxy는 새 컨테이너이므로 기동 후 다른 서비스에 영향이 없는지 확인한다.

**Task 3 병합 후 운영에서 실제 수집을 한 번 돌린다.** 공용 VPS의 12개 컨테이너가 들어오는지, 그리고 **DB에 비밀값이 없는지**를 직접 확인한다. 이것이 M2에서 가장 중요한 검증이다.
