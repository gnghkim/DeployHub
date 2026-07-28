# DeployHub M3 (모니터링) Implementation Plan

> **For agentic workers:** orca orchestration으로 codex 워커에게 카드 단위 위임된다. 각 Task는 격리 worktree에서 수행하고, 검증 명령이 모두 통과한 뒤 Claude의 설계 부합 검토를 거쳐 main에 병합한다.

**Goal:** 구축방안 1.1의 질문 ②에 답한다 — **지금 정상인가.** 상태를 주기적으로 관측하고, 변한 순간을 `change_events`에 남기고, 사람이 화면에서 그 흐름을 본다.

**Architecture:** 관측 주기를 셋으로 나눈다. HTTP 헬스체크 5분, 컨테이너 상태 1분, SSL 만료 1일. 각 검사는 결과를 저장하는 것이 아니라 **직전 상태와 비교해 달라졌을 때만** `change_events`에 한 줄을 남긴다. 판정(정상·주의·장애·미확인)은 저장하지 않고 조회 시 계산한다 — M2의 Drift와 같은 이유다.

**Tech Stack:** 기존 스택. **새 외부 의존성 없음** — HTTP는 `fetch`, TLS는 Node 내장 `node:tls`.

**선행:** M2 완료(`docs/superpowers/plans/2026-07-27-deployhub-m2-뒷단파악.md`), UI 재설계 완료(`docs/superpowers/plans/2026-07-28-deployhub-ui-재설계.md`), 구축방안 §7.3·§18.3

---

## 이 계획서는 UI 재설계 전에 쓰였다 — Task 5·6은 개정본을 따른다

Task 1~4는 화면을 건드리지 않으므로 그대로다. Task 5·6은 아래가 바뀐 뒤에 쓰였다.

- 루트 `/`가 Overview(숫자 카드 묶음)에서 **프로젝트 목록**으로 바뀌었다. **M2에서 만든 숫자 카드는 삭제됐다.** "카드 옆에 붙인다"는 지시는 무효다.
- 프로젝트 상세가 다섯 섹션에서 **구성도 하나**로 합쳐졌다.
- 사이드바 최상위가 **프로젝트 · 발견 · 설정** 셋으로 정리됐다.
- 목록과 표는 `md` 미만에서 **카드로 쌓인다.** 열을 더하면 모바일 카드에도 더해야 한다.

Task 5·6 본문의 개정 사항을 각 Task 안에 적어 뒀다.

---

## 알림은 이 마일스톤에서 만들지 않는다

Telegram 봇 토큰은 BotFather에서 사람이 만들어야 하고 아직 없다. 알림 없이 먼저 간다.

**다만 나중에 붙일 때 구조를 뒤엎지 않도록 지금 정한다.**

- `change_events`에 `severity`와 `notified_at`을 처음부터 넣는다. 알림기는 나중에 `notified_at IS NULL AND severity >= ...`를 읽어 보내고 표시만 하면 된다. **새 마이그레이션 없이 붙는다.**
- 검사 핸들러는 알림을 직접 보내지 않는다. `change_events`에 쓰기만 한다. 검사와 발송을 섞으면 알림 채널이 늘 때마다 검사 코드를 고쳐야 한다.

`notified_at`이 M3 동안 영원히 `NULL`인 것은 정상이다. 미완성이 아니다.

---

## Global Constraints

M1·M2의 Global Constraints를 그대로 승계하고 아래를 더한다.

- **상태를 매 검사마다 저장하지 않는다.** 1분 주기 검사가 매번 행을 쓰면 하루 1,440행 × 자원 수가 쌓인다. **달라졌을 때만** 쓴다.
- **판정은 저장하지 않는다.** 조회 시 계산한다. 저장하면 낡는다(M2 Drift와 같은 이유).
- **검사 실패와 대상 장애를 구분한다.** 우리 쪽 네트워크 오류로 못 물어본 것과 상대가 죽은 것은 다르다. 전자를 장애로 기록하면 신뢰를 잃는다.
- **외부 요청에 반드시 타임아웃을 건다.** `AbortSignal.timeout()`을 쓴다. 타임아웃 없는 `fetch`는 worker 루프를 영구히 막는다.
- **시간은 DB 시계만 쓴다.**
- **새로 만드는 화면은 `md` 미만에서도 읽혀야 한다.** 여백은 `p-4 md:p-8`, 표는 `md` 미만에서 카드로 쌓는다. 기존 화면이 그렇게 돼 있으니 따라라.
- **`docs/`는 각 Task의 산출물이 아니다.**

---

## 선행 수정 — job 중복 방지

**현재 `enqueue`는 무조건 새 행을 넣는다.** 중복 검사가 없다.

지금은 문제가 없다. 가장 짧은 주기가 5분인데 처리가 그보다 오래 걸리는 일이 없기 때문이다. **M3는 1분 주기를 들여온다.** 처리가 1분을 넘기는 순간(Docker API가 느리거나 컨테이너가 많거나) 큐가 무한히 쌓이고, 그 뒤로는 계속 밀린 작업만 처리하게 된다.

Task 1에서 함께 고친다. 자세한 것은 Task 1 Step 3에 있다.

---

## Task 1: change_events 스키마와 job 중복 방지

M3 전체의 토대다. 이 카드가 없으면 나머지가 쓸 곳이 없다.

**Files:**
- Create: `packages/db/src/schema/events.ts`
- Modify: `packages/db/src/schema/index.ts`, `packages/db/src/schema/enums.ts`
- Create: `drizzle/0006_*.sql`
- Create: `packages/db/src/queries/events.ts`, `events.test.ts`
- Modify: `packages/db/src/jobs/queue.ts`, 해당 테스트
- Modify: `packages/db/src/index.ts`

**Interfaces:**

```ts
export type ChangeEventInput = {
  projectId: string | null;
  componentId: string | null;
  resourceId: string | null;
  kind: ChangeEventKind;
  severity: 'info' | 'warning' | 'critical';
  previousValue: string | null;
  currentValue: string;
  detail: string;
};

/** 직전 이벤트와 currentValue 가 같으면 쓰지 않는다. 쓰면 true. */
export function recordChangeIfChanged(
  db: Db,
  input: ChangeEventInput,
): Promise<boolean>;

/** 같은 type 의 pending job 이 이미 있으면 넣지 않는다. 넣었으면 true. */
export function enqueueUnique(
  db: Db,
  options: EnqueueOptions,
): Promise<boolean>;
```

- [ ] **Step 1: 실패하는 스키마 테스트 작성**

`change_event_kind` enum 값:

```
health_status    // HTTP 헬스체크 결과가 바뀜
container_status // 컨테이너 running/exited 등이 바뀜
container_health // Docker healthcheck 결과가 바뀜
deployment       // 새 배포가 관측됨
ssl_expiry       // SSL 만료일이 바뀌거나 임계에 들어옴
sync_failure     // Provider 동기화 실패
```

검증할 것:
1. `severity`가 `info`·`warning`·`critical` 밖이면 거부한다
2. `projectId`·`componentId`·`resourceId`가 모두 `null`이어도 삽입된다 (전역 이벤트용)
3. `notified_at`은 기본 `null`이다
4. `occurred_at`이 DB `now()`로 채워진다

- [ ] **Step 2: 실패 확인 → 스키마 구현**

```ts
export const changeEvents = pgTable(
  'change_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    componentId: uuid('component_id').references(() => components.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id').references(() => resources.id, { onDelete: 'cascade' }),
    kind: changeEventKind('kind').notNull(),
    severity: eventSeverity('severity').notNull(),
    previousValue: text('previous_value'),
    currentValue: text('current_value').notNull(),
    detail: text('detail').notNull(),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('change_events_occurred_idx').on(t.occurredAt),
    index('change_events_project_occurred_idx').on(t.projectId, t.occurredAt),
    index('change_events_unnotified_idx').on(t.notifiedAt, t.severity),
  ],
);
```

세 인덱스가 각각 타임라인 전체 조회, 프로젝트별 조회, 나중의 알림기를 위한 것이다.

Run: `pnpm --filter @deployhub/db exec drizzle-kit generate`

**생성된 SQL을 읽어라.** `change_events` 테이블과 enum 두 개를 **추가**할 뿐이어야 한다. 기존 테이블을 건드리는 문장이 있으면 멈추고 보고하라.

- [ ] **Step 3: job 중복 방지**

`enqueue`는 그대로 두고 **`enqueueUnique`를 새로 만든다.** 기존 호출부의 동작을 바꾸면 안 된다.

```sql
INSERT INTO jobs (type, payload, run_at, max_attempts)
SELECT ${type}, ${payload}::jsonb, now(), ${maxAttempts}
WHERE NOT EXISTS (
  SELECT 1 FROM jobs
  WHERE type = ${type} AND status IN ('pending', 'running')
)
RETURNING id
```

반환 행이 없으면 `false`다.

`status IN ('pending','running')`인 이유: `pending`만 보면 이미 실행 중인 작업과 겹쳐 같은 검사가 둘 돈다. `running`까지 보면 한 번에 하나만 돈다.

검증할 것:
- pending job이 있으면 `enqueueUnique`가 `false`를 반환하고 행이 늘지 않는다
- running job이 있어도 `false`다
- succeeded/failed만 있으면 새로 넣는다
- 다른 `type`은 서로 막지 않는다

- [ ] **Step 4: recordChangeIfChanged 테스트와 구현**

같은 대상의 가장 최근 이벤트를 찾아 `currentValue`가 같으면 쓰지 않는다.

"같은 대상"은 `(resourceId, kind)`로 본다. `resourceId`가 `null`이면 `(componentId, kind)`, 그것도 `null`이면 `(projectId, kind)`다.

`previousValue`는 호출자가 넘기지 말고 **직전 이벤트의 `currentValue`에서 채운다.** 호출자가 넘기면 두 곳이 어긋날 수 있다.

검증할 것:
- 첫 기록은 `previousValue`가 `null`이고 `true`를 반환한다
- 같은 값으로 다시 부르면 `false`를 반환하고 행이 늘지 않는다
- 다른 값이면 `previousValue`가 직전 값으로 채워진다
- `running → exited → running`이면 행이 3개다 (되돌아온 것도 변화다)

- [ ] **Step 5: 검증과 커밋**

Run: `pnpm typecheck && pnpm test`

**게이트 통과 조건:** 마이그레이션이 추가만 할 것. `enqueue`의 기존 동작이 바뀌지 않을 것. 같은 값 재기록이 없을 것.

---

## Task 2: HTTP 헬스체크

**Files:**
- Create: `packages/collectors/src/health/{index,check}.ts`, `check.test.ts`
- Create: `apps/worker/src/handlers/health-check.ts`, `health-check.test.ts`
- Modify: `apps/worker/src/handlers/index.ts`, `apps/worker/src/index.ts`

**Interfaces:**

```ts
export type HealthResult =
  | { kind: 'up'; status: number; latencyMs: number }
  | { kind: 'down'; status: number; latencyMs: number }
  | { kind: 'unreachable'; reason: 'timeout' | 'network'; latencyMs: number };

export function checkHttp(url: string, timeoutMs: number): Promise<HealthResult>;
```

- [ ] **Step 1: 실패하는 검사 테스트 작성**

**`unreachable`을 `down`과 분리하는 것이 이 카드의 요점이다.** 상대가 500을 준 것과 우리가 물어보지 못한 것은 다르다. 전자는 상대 장애이고 후자는 우리 쪽 문제일 수 있다. 섞으면 네트워크가 흔들릴 때마다 거짓 장애가 뜬다.

검증할 것:
1. 200~399면 `up`
2. 400~599면 `down`이고 `status`가 그대로 담긴다
3. `fetch`가 `AbortError`를 던지면 `unreachable`/`timeout`
4. 그 외 예외는 `unreachable`/`network`
5. `latencyMs`가 세 경우 모두 채워진다
6. **리다이렉트를 따라가지 않는다** (`redirect: 'manual'`) — 307을 `up`으로 볼지 판단하는 것은 우리 몫이다
7. 응답 본문을 읽지 않는다 — 큰 본문을 받을 이유가 없다

- [ ] **Step 2: 실패 확인 → 구현**

```ts
const response = await fetch(url, {
  method: 'GET',
  redirect: 'manual',
  signal: AbortSignal.timeout(timeoutMs),
});
```

`HEAD`가 아니라 `GET`인 이유: `HEAD`를 제대로 처리하지 않는 앱이 흔하다. 본문은 읽지 않으므로 비용 차이가 크지 않다.

**응답 본문·헤더를 저장하지 마라.** 상태 코드와 지연 시간만 쓴다. 본문에는 무엇이든 들어올 수 있다.

- [ ] **Step 3: worker 핸들러**

`health.check`를 등록한다. 5분 주기, `enqueueUnique`로 넣는다.

대상은 `domains` 테이블과 `components.url`이다. 둘 다 없으면 조용히 아무것도 하지 않는다.

- 결과를 `recordChangeIfChanged`에 넘긴다. `kind: 'health_status'`
- `currentValue`는 `up`·`down (500)`·`unreachable (timeout)` 형태의 짧은 문자열
- severity: `up` → `info`, `down` → `critical`, `unreachable` → `warning`

**`unreachable`이 `warning`인 이유:** 우리가 못 물어본 것이라 상대의 장애를 단정할 수 없다. 사람이 보고 판단할 일이다.

동시 요청은 4개로 제한한다. 도메인이 늘어도 한꺼번에 나가지 않게 한다.

- [ ] **Step 4: 검증과 커밋**

Run: `pnpm typecheck && pnpm test`

**게이트 통과 조건:** `unreachable`과 `down`이 분리될 것. 타임아웃이 걸려 있을 것. 본문을 저장하지 않을 것.

---

## Task 3: 컨테이너 상태 감시 (1분)

**Files:**
- Create: `apps/worker/src/handlers/docker-health.ts`, `docker-health.test.ts`
- Modify: `packages/collectors/src/docker/index.ts` (가벼운 목록 조회 추가)
- Modify: `apps/worker/src/handlers/index.ts`, `apps/worker/src/index.ts`

- [ ] **Step 1: 가벼운 조회를 따로 만든다**

**기존 `listResources()`를 1분마다 부르지 마라.** 그것은 컨테이너마다 `inspect`를 한 번씩 하고 `stats`까지 부른다. 13개면 27번의 요청이다. 1분 주기로는 과하다.

`GET /containers/json?all=1` **한 번**으로 끝내는 함수를 더한다.

```ts
export type ContainerStatus = {
  externalId: string;   // 전체 컨테이너 ID
  name: string;         // 앞 슬래시 뗀 이름
  state: string;        // running, exited, restarting ...
  status: string;       // "Up 2 hours (healthy)" 원문
};

export function listContainerStatuses(): Promise<ContainerStatus[]>;
```

`/containers/json` 응답의 `Names[0]`, `State`, `Status`만 쓴다. **다른 필드를 담지 마라** — 이 응답에도 `Labels`와 `Mounts`가 들어 있고 M2 Task 4에서 정한 규칙이 그대로 적용된다.

`Status` 문자열에서 `(healthy)`·`(unhealthy)`·`(health: starting)`을 뽑아 health로 쓴다. 없으면 `null`이다.

- [ ] **Step 2: 실패하는 테스트 작성**

검증할 것:
1. `Names`의 앞 슬래시가 제거된다
2. `Status`에서 health를 뽑는다 — `"Up 2 hours (healthy)"` → `healthy`
3. health 표기가 없으면 `null`
4. **응답의 `Labels`·`Mounts`·`Image`가 결과에 없다** — 키 집합을 정확히 비교
5. 상한 256을 넘으면 실패한다 (M2 Task 4와 같은 이유)

- [ ] **Step 3: worker 핸들러**

`docker.health`를 등록한다. 1분 주기, `enqueueUnique`로 넣는다. `DOCKER_HOST_URL`이 없으면 조용히 건너뛴다.

- `resources`에서 `provider='docker'`이고 `deleted_at IS NULL`인 것과 대조한다
- 상태가 바뀌었으면 `recordChangeIfChanged`, `kind: 'container_status'`
- health가 바뀌었으면 별도로 `kind: 'container_health'`
- severity: `running` → `info`, `exited`·`dead` → `critical`, `restarting` → `warning`, `unhealthy` → `critical`

**이 핸들러는 `resources`를 갱신하지 않는다.** 그것은 5분짜리 `docker.sync`의 일이다. 두 핸들러가 같은 행을 쓰면 서로 덮어쓴다. 이 핸들러는 **읽고 비교해서 이벤트만 쓴다.**

**목록에 없는 컨테이너를 삭제로 기록하지 마라.** 사라진 것의 판정은 `docker.sync`가 한다. 1분 검사가 한순간의 목록으로 그것을 판단하면 재배포 중 잠깐 사라진 것도 장애가 된다.

- [ ] **Step 4: 검증과 커밋**

**게이트 통과 조건:** `inspect`를 부르지 않을 것. `resources`를 쓰지 않을 것. 사라진 컨테이너를 이벤트로 남기지 않을 것.

---

## Task 4: SSL 만료 관측 (1일)

**Files:**
- Create: `packages/collectors/src/tls/{index,certificate}.ts`, `certificate.test.ts`
- Create: `apps/worker/src/handlers/ssl-check.ts`, `ssl-check.test.ts`
- Modify: `apps/worker/src/handlers/index.ts`, `apps/worker/src/index.ts`

**Interfaces:**

```ts
export type CertificateResult =
  | {
    kind: 'ok';
    validTo: string;
    issuer: string;
    daysRemaining: number;
    /** 표준 검증을 통과했는가. false 면 만료·자체서명·이름 불일치 중 하나다. */
    verified: boolean;
    /** verified 가 false 일 때의 Node 오류 코드. 예: CERT_HAS_EXPIRED */
    verificationError: string | null;
  }
  | { kind: 'error'; reason: 'timeout' | 'handshake' | 'no_certificate' };

export function fetchCertificate(
  host: string,
  timeoutMs: number,
): Promise<CertificateResult>;
```

- [ ] **Step 1: 구현 방식**

**DNS 제공자 API를 쓰지 않는다.** 가비아에 등록된 값이 아니라 **지금 실제로 서빙되는 인증서**를 본다. 등록 값과 실제가 다를 수 있고, 우리가 알고 싶은 것은 후자다.

`node:tls`의 `tls.connect`로 핸드셰이크만 하고 `getPeerCertificate()`를 읽은 뒤 즉시 끊는다. HTTP 요청을 보내지 않는다.

```ts
const socket = tls.connect({
  host,
  port: 443,
  servername: host,   // SNI. 없으면 공용 서버에서 엉뚱한 인증서가 온다
  timeout: timeoutMs,
});
```

**`servername`을 반드시 넣어라.** 배포 대상은 한 IP에 여러 도메인이 붙은 공용 VPS다. SNI가 없으면 Caddy가 기본 인증서를 주고, 우리는 엉뚱한 만료일을 저장하게 된다.

**`rejectUnauthorized: false`로 두되, 검증 결과를 버리지 말고 기록한다.**

이 값을 끄는 이유는 하나다. 켜 두면 **만료된 인증서에서 핸드셰이크가 실패해 만료일을 읽지 못한다.** 우리가 가장 알고 싶은 상황에서 아무것도 알 수 없게 되는 것이다.

그런데 끄기만 하면 다른 문제가 생긴다. 중간자가 가짜 인증서로 넉넉한 만료일을 내밀면 우리는 그것을 그대로 믿고 "정상"이라고 기록한다. **임박한 만료를 숨기는 데 쓰일 수 있다.**

두 문제를 한꺼번에 푼다. Node는 `rejectUnauthorized: false`여도 검증을 **수행하고** 결과를 소켓에 남긴다.

```ts
const socket = tls.connect({
  host,
  port: 443,
  servername: host,
  rejectUnauthorized: false,   // 만료된 인증서도 읽기 위해
  timeout: timeoutMs,
});
// 핸드셰이크 후
const verified = socket.authorized;
const verificationError = socket.authorized
  ? null
  : (socket.authorizationError?.toString() ?? 'UNKNOWN');
```

즉 **검증을 끄는 것이 아니라, 검증에 실패해도 연결을 끊지 않을 뿐이다.** 결과는 그대로 읽어 `verified`에 담는다.

`verified === false`는 그 자체로 알릴 가치가 있는 사건이다. Step 3에서 이벤트로 남긴다.

이 연결로는 요청도 응답도 주고받지 않는다. 인증서를 읽고 즉시 끊는 것이 전부다.

- [ ] **Step 2: 실패하는 테스트 작성**

`tls.connect`를 주입 가능하게 만들어 테스트한다. 실제 네트워크에 나가지 마라.

검증할 것:
1. `validTo`를 ISO 8601로 변환한다
2. `daysRemaining`을 DB 시각이 아니라 **호출자가 넘긴 기준 시각**으로 계산한다 (테스트 가능하도록)
3. 인증서가 비어 있으면 `no_certificate`
4. 타임아웃이면 `timeout`
5. 핸드셰이크 실패면 `handshake`
6. **결과에 인증서 원문(`raw`)이나 공개키가 없다** — `validTo`와 `issuer` 문자열만
7. 소켓이 모든 경로에서 닫힌다 (성공·실패·타임아웃)
8. `socket.authorized === true`면 `verified: true`, `verificationError: null`
9. `socket.authorized === false`면 `verified: false`이고 `verificationError`에 오류 코드가 담긴다 — **그래도 `validTo`는 읽힌다**

7번이 중요하다. **닫지 않으면 소켓이 샌다.** 하루 한 번이라 티가 안 나다가 몇 달 뒤 worker가 죽는다.

9번이 이 카드의 보안 요점이다. 검증 실패를 조용히 삼키면 가짜 만료일을 정상으로 기록하게 된다.

- [ ] **Step 3: worker 핸들러**

`ssl.check`를 등록한다. 24시간 주기, `enqueueUnique`.

대상은 `domains` 테이블이다. `domains.ssl_expires_at`과 `last_checked_at`을 갱신한다.

- 만료일이 바뀌었으면 `recordChangeIfChanged`, `kind: 'ssl_expiry'`
- 30일 이내면 `warning`, 7일 이내면 `critical`, 그 외 `info`
- 오류면 `warning` — 인증서를 못 읽은 것이지 만료된 것이 아니다
- **`verified === false`면 만료일과 무관하게 `critical`이다.** `currentValue`에 `unverified (CERT_HAS_EXPIRED)`처럼 오류 코드를 함께 적는다

마지막이 중요하다. 검증에 실패한 인증서는 만료일이 넉넉해도 문제다. 자체서명이거나 이름이 맞지 않거나 이미 만료된 것인데, **셋 다 사용자 브라우저에 경고가 뜨는 상태다.** 만료일만 보고 정상이라고 하면 안 된다.

`verified === false`인 채로 만료일이 넉넉하다면 중간자를 의심할 여지도 있다. 사람이 봐야 할 일이라 `critical`로 올린다.

`last_checked_at`은 성공·실패 모두 갱신한다. 언제 마지막으로 시도했는지가 정보다.

- [ ] **Step 4: 검증과 커밋**

**게이트 통과 조건:** `servername`이 설정될 것. `socket.authorized`를 읽어 `verified`에 담을 것. 소켓이 모든 경로에서 닫힐 것. 인증서 원문을 저장하지 않을 것.

---

## Task 5: 상태 판정과 대시보드

**Files:**
- Create: `packages/db/src/queries/status.ts`, `status.test.ts`
- Modify: `packages/db/src/queries/projects.ts` (`listProjectsWithSummaryData`에 이벤트 조회 한 건 추가)
- Modify: `apps/web/src/app/page.tsx` (목록의 열 + 모바일 카드)
- Modify: `apps/web/src/app/projects/[slug]/page.tsx`

**Interfaces:**

```ts
export type ProjectStatus = '정상' | '주의' | '장애' | '미확인';

export function judgeStatus(input: {
  latestEvents: Array<{ kind: string; severity: string; occurredAt: Date }>;
  hasObservation: boolean;
  now: Date;
}): ProjectStatus;
```

- [ ] **Step 1: 판정 규칙을 순수 함수로**

구축방안 18.3의 판정이다. **저장하지 않고 조회 시 계산한다.**

```
관측 자체가 없다                        → 미확인
최근 critical 이벤트가 살아 있다          → 장애
최근 warning 이벤트가 살아 있다           → 주의
그 외                                  → 정상
```

"살아 있다"는 **같은 대상의 더 최근 `info` 이벤트가 없다**는 뜻이다. `exited` 뒤에 `running`이 왔으면 장애는 끝난 것이다.

검증할 것:
1. 이벤트가 하나도 없고 관측도 없으면 `미확인`
2. 이벤트가 없지만 관측은 있으면 `정상`
3. `critical` 하나만 있으면 `장애`
4. `critical` 뒤에 같은 대상의 `info`가 오면 `정상`
5. `critical` 뒤에 **다른 대상의** `info`가 와도 여전히 `장애`
6. `warning`과 `critical`이 함께 살아 있으면 `장애` (더 나쁜 쪽)

5번이 핵심이다. 대상을 구분하지 않으면 무관한 컨테이너가 복구됐다고 장애가 사라진다.

- [ ] **Step 2: 조회 — 프로젝트 수에 비례하지 않게**

**이것이 이 카드에서 가장 틀리기 쉬운 지점이다.**

`listProjectsWithSummaryData`(`packages/db/src/queries/projects.ts`)는 프로젝트가 몇 개든 **조회 4번**으로 끝나도록 설계돼 있다. UI 재설계 Task 1에서 그렇게 만들었다. 판정을 붙이면서 프로젝트마다 이벤트를 조회하면 그 성질이 무너지고, 프로젝트가 늘수록 목록이 느려진다.

**한 번의 조회로 모든 프로젝트의 최근 이벤트를 가져와 메모리에서 묶어라.** `selectDistinctOn`으로 `(projectId, resourceId, componentId, kind)`별 최신 이벤트만 뽑으면 된다. 같은 파일에 `deployments`를 그렇게 처리한 선례가 있으니 읽고 따라라.

`판정`은 DB에서 계산하지 마라. 조회는 **최신 이벤트만** 내고, `judgeStatus`가 그것을 받는다. 판정 규칙이 SQL과 TS 두 곳에 생기면 갈라진다.

검증할 것:
- 프로젝트가 1개일 때와 10개일 때 **발행되는 조회 수가 같다**
- 이벤트가 없는 프로젝트도 결과에서 빠지지 않는다 (`미확인`이 되어야 하므로)

- [ ] **Step 3: 화면**

**목록(`/`)** — `구성 | 배포 | DB | 최근 배포` 옆에 판정을 더한다.

숫자 카드를 만들지 마라. **UI 재설계 Task 2에서 지웠다.** "3개 정상, 1개 장애"라는 숫자만으로는 어느 것이 장애인지 알 수 없어 결국 목록을 다시 봐야 한다. 판정은 **각 행에** 붙을 때 쓸모가 있다.

판정을 **첫 열**에 둔다. 프로젝트 이름 왼쪽이다. 훑을 때 가장 먼저 보여야 하는 것이고, 오른쪽 끝에 두면 열이 늘었을 때 잘린다.

`md` 미만에서는 표가 카드로 쌓인다(모바일 대응 카드에서 그렇게 했다). **카드에도 판정을 넣어라.** 표에만 넣으면 폰에서 안 보인다.

색은 새로 만들지 마라. `DESIGN-raycast.md`의 토큰만 쓴다. **`정상`을 눈에 띄게 칠하지 마라** — 대부분이 정상이라 화면이 색으로 덮인다. 정상은 조용하게, 주의·장애만 드러나게 한다.

**프로젝트 상세** — 상세는 이제 구성도 하나다. 판정을 맨 위 한 줄(`production · 중요도 4 · gnghkim`)에 함께 둔다.

**판정만 보여주고 근거를 감추지 마라.** 왜 장애인지 모르면 화면이 쓸모없다. 근거가 된 이벤트를 구성도 아래에 둔다.

구성도의 각 줄은 이미 오른쪽이 관측(컨테이너 이름·상태)이다. **그 자리를 판정으로 덮어쓰지 마라.** 관측은 사실이고 판정은 해석이라 자리가 다르다. 이 구분이 시스템 전체의 토대다.

- [ ] **Step 4: 검증과 커밋**

**게이트 통과 조건:** 판정이 파생 계산일 것. 대상별로 해소를 판단할 것. 조회 수가 프로젝트 수에 비례하지 않을 것. 모바일 카드에도 판정이 있을 것.

---

## Task 6: 변경 타임라인 화면

**Files:**
- Create: `apps/web/src/app/events/page.tsx`, `page.test.ts`
- Create: `packages/db/src/queries/timeline.ts`, `timeline.test.ts`
- Modify: `apps/web/src/app/projects/[slug]/page.tsx` (프로젝트별 타임라인)
- Modify: `apps/web/src/components/shell/sidebar-shell.tsx`

**네비게이션 — 개정.** 사이드바 최상위는 UI 재설계 Task 5에서 **프로젝트 · 발견 · 설정** 셋으로 정리됐다. 그 기준은 "매일 보는 것은 위, 등록·연결 도구는 설정 안"이었다.

변경 내역은 무언가 이상할 때 보는 것이라 매일 보는 쪽에 속한다. **최상위에 `변경`을 더해 넷으로 만든다.** `/events`다. 위치는 `발견` 아래, `설정` 위다.

`설정` 안에 넣지 마라. 설정은 등록·연결 도구를 모아 둔 곳이고 타임라인은 도구가 아니다.

`ACTIVE_ITEMS` 배열에 한 줄을 더하는 것이 전부다. **드로어 동작을 건드리지 마라** — 모바일 대응에서 만든 것이 이미 동작한다.

**배지를 달지 마라.** UI 재설계 Task 5에서 배지는 등록 초안 하나로 제한했다. 이벤트는 `info`가 대부분이라 숫자를 붙이면 늘 켜져 있고, 그러면 진짜 배지인 초안이 묻힌다.

- [ ] **Step 1: 조회**

전체 타임라인과 프로젝트별 타임라인을 같은 함수로 낸다. `projectId`가 `null`이면 전체다.

**페이지네이션에 상한을 둔다.** `change_events`는 계속 쌓인다. 기본 100건, 커서는 `occurred_at`이다. M2 Task 3에서 배운 것이다 — 전부 가져오는 조회는 시간이 지나면 반드시 문제가 된다.

`kind`와 `severity`로 거를 수 있어야 한다.

- [ ] **Step 2: 화면**

시각은 M2 Task 6에서 정한 방식을 따른다. 서버에서 계산한 정적 상대 시각 + `<time dateTime>`의 절대 시각. 클라이언트에서 계산하지 마라.

`previousValue → currentValue` 형태로 무엇이 어떻게 바뀌었는지 보여준다. `detail`은 그 아래 작게 둔다.

severity별로 색을 다르게 하되 `info`가 대부분이므로 조용하게 둔다. **모든 줄이 경고처럼 보이면 진짜 경고가 묻힌다.**

이벤트가 없으면 "아직 기록된 변경이 없습니다"라고 명시한다. 빈 화면과 다르다.

- [ ] **Step 3: 보존 정책**

`change_events`를 무한히 쌓지 않는다. **90일보다 오래된 것을 지운다.**

`docker.sync`의 스냅샷 정리와 같은 자리에서 한다. 별도 job을 만들지 마라 — 주기적으로 도는 것이 이미 있는데 하나 더 만들면 스케줄이 늘어난다.

90일인 이유: 분기 회고에 쓸 만한 길이이고, 그보다 오래된 상태 변화는 볼 일이 없다. 오래 남길 가치가 있는 것은 `deployments`에 따로 있다.

- [ ] **Step 4: 검증과 커밋**

Run: `pnpm typecheck && pnpm test && pnpm --filter web build`

**게이트 통과 조건:** 페이지네이션 상한이 있을 것. 상대 시각이 서버 계산일 것. 보존 정책이 있을 것.

---

## Self-Review

**1. 구축방안 커버리지**

| 항목 | Task |
|---|---|
| HTTP 헬스체크 5분 | 2 |
| 컨테이너 상태 1분 | 3 |
| SSL 만료 1일 (TLS 핸드셰이크) | 4 |
| 7.3 `change_events`와 상태 전이 감지 | 1 |
| 18.3 정상·주의·장애·미확인 판정 | 5 |
| 변경 타임라인 화면 | 6 |
| Telegram 알림 | **보류** — 봇 토큰이 없다. `notified_at`으로 자리만 잡는다 |
| 아침 일별 요약 | **보류** — 위와 같다 |
| 외부 dead man's switch (R7) | **보류** — 알림과 함께 |

**2. 타입 일관성**

- `ChangeEventInput` — Task 1 정의, Task 2·3·4가 생산, Task 5·6이 소비 ✓
- `enqueueUnique` — Task 1 정의, Task 2·3·4가 사용 ✓
- `ContainerStatus` — Task 3 정의, Task 3만 사용 ✓
- `ProjectStatus` — Task 5 정의, Task 5가 소비 ✓
- M2의 `ExternalResource`·`resources`·`domains` — 변경 없이 읽기만 ✓

**3. 위험 지점**

- **1분 주기의 큐 적체.** `enqueueUnique`로 막는다. Task 1에서 먼저 한다.
- **타임아웃 없는 외부 요청.** worker 루프가 영구히 막힌다. HTTP·TLS 모두 타임아웃을 강제한다.
- **SNI 누락.** 공용 VPS라 엉뚱한 인증서를 읽게 된다. Task 4에서 명시한다.
- **검증 결과를 버리는 것.** `rejectUnauthorized: false`는 만료된 인증서의 만료일을 읽기 위해 필요하지만, 검증 결과까지 버리면 가짜 인증서의 넉넉한 만료일을 정상으로 기록하게 된다. `socket.authorized`를 읽어 `verified`에 담고, `false`면 `critical`로 올린다.
- **TLS 소켓 누수.** 하루 한 번이라 늦게 드러난다. 모든 경로에서 닫는 것을 테스트로 고정한다.
- **`docker.health`와 `docker.sync`의 쓰기 충돌.** 전자는 읽기만 한다.
- **거짓 장애.** `unreachable`을 `down`과 분리하고, 사라진 컨테이너를 1분 검사가 판단하지 않는다.
