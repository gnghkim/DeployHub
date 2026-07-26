# DeployHub 시스템 구축방안

> **근거 문서:** `DeployHub_통합_프로젝트_인프라_관리시스템_구축계획서.md` v3.0, `DESIGN-raycast.md`
> **작성일:** 2026-07-26
> **성격:** 계획서가 정의한 *무엇을*에 대해, *어떻게 만들 것인가*를 확정한 실행 설계

---

## 1. 이 문서의 위치

계획서 v3.0은 관리 대상, 데이터 모델, API, CLI, 인증까지 47개 절에 걸쳐 정의를 마쳤다. 부족한 것은 정의가 아니라 **선택**이다. 계획서는 여러 지점에서 선택지를 열어 두었고(ORM, 인증 방식, Turborepo 채택 여부, Redis 사용 여부), 6단계·17항목의 순서를 제시했으나 그 순서는 특정 운영 규모나 특정 사용 목적을 전제하지 않았다.

이 문서는 아래 전제 위에서 그 선택들을 닫는다.

| 전제 | 값 |
|---|---|
| 개발·운영 체제 | 1인 + 바이브코딩 AI |
| 관리 대상 프로젝트 | 약 20개 |
| 웹 사용자 | 1~2명 |
| 배포처 분포 | Vercel과 Hostinger VPS Docker가 절반씩 |
| DeployHub 배포 | Hostinger VPS 1대, Docker Compose |
| 도메인·DNS | 가비아. CDN·프록시 계층 없음 (오리진 직결) |
| 사용 방식 | 평소엔 보지 않는다. 상태가 바뀌면 알림을 받고, 하루 한두 번 변경을 점검한다 |

### 1.1 무엇에 답해야 하는가

이 시스템의 존재 이유는 세 가지 질문이다.

1. **배포 중인 각 프로젝트가 뒷단에 어떤 시스템을 쓰는가** — DB, 인증, 스토리지, 캐시, 외부 API
2. **지금 정상인가** — 그리고 문제가 생기면 내가 화면을 보고 있지 않아도 알 수 있는가
3. **깃 연동과 최종 배포는 어떤 상태인가** — 마지막 커밋, 마지막 배포, 성공했는가

세 질문 모두 **선언이 아니라 관측**으로 답한다. `deployhub.yaml`을 아무리 잘 써도 최종 배포 시각이나 컨테이너 생사는 알 수 없다. 따라서 이 문서는 계획서 46절의 순서를 뒤집어 **Provider 관측을 앞에, 선언 도구(CLI)를 뒤에** 둔다. 근거는 8절에 있다.

---

## 2. 계획서 대비 축소 결정

계획서를 원안대로 실행하면 컨테이너 8개, 테이블 31개가 된다. 1인·20프로젝트 규모에서 이 중 상당수는 행이 한두 개인 테이블이거나 기능이 겹치는 컨테이너가 된다.

| 제외 대상 | 계획서 위치 | 근거 |
|---|---|---|
| Uptime Kuma | 8.1, 18.1 | worker의 HTTP·SSL 헬스체크와 기능이 겹친다. 별도 앱 운영과 Monitor ID 연동 코드가 순수 추가 비용 |
| Redis / BullMQ | 8.1, 9.4 | 20프로젝트 규모에 PostgreSQL `FOR UPDATE SKIP LOCKED`로 충분 |
| Turborepo | 22 | 앱 2개. 빌드 캐싱 이득이 설정·유지 비용을 넘지 못한다 |
| `teams`, `project_owners` | 15.1 | 사용자 1~2명. `projects.owner TEXT` 한 컬럼으로 대체 |
| `audit_logs`, `integration_events` | 15.1, 15.9 | 사람의 행위 로그는 불필요. **관측 변경 로그는 `change_events`로 별도 신설** (7.4) |
| `alerts` 테이블 | 15.1 | `change_events.notified_at`으로 흡수. 알림은 이벤트의 속성이지 별개 개체가 아니다 |
| `monitoring_snapshots` | 15.1 | `health_checks`(현재 상태) + `container_snapshots`(시계열)로 분리 |
| 별도 `docker-collector` 컨테이너 | 12 | `docker-socket-proxy`가 이미 읽기 전용 경계다. 컨테이너를 하나 더 두는 것은 경계를 두 번 긋는 것 |
| Cloudflare Access | 8.4, 9.3 | 3절에서 상술 |
| Device Login, OIDC, MCP | 38.3, 40, 41 | M5 이후. MVP는 일회용 등록 토큰과 HMAC으로 성립한다 |

**되돌릴 수 있게 남긴다.** Job은 `jobs` 테이블 뒤에 인터페이스를 두어 BullMQ로 교체 가능하게 하고, 헬스체크 결과는 Uptime Kuma를 붙여도 같은 `health_checks`로 흘러들게 한다. 팀 권한이 필요해지면 `projects.owner`를 FK로 승격한다.

---

## 3. 접근 통제 — Cloudflare Access를 쓰지 않는 이유

계획서 8.4는 `Cloudflare Access + 자체 계정 인증`을 권장했다. 이 구성은 1인 규모에서 비용 대비 효용이 맞지 않는다.

**우회 가능성.** Access는 엣지에서만 검사한다. VPS 공인 IP로 직접 접속하면 검사가 일어나지 않는다. 이를 막으려면 `cloudflared` 터널, Cloudflare IP 대역만 허용하는 방화벽, 또는 Authenticated Origin Pulls 중 하나가 추가로 필요하다. "코드 0줄"이 아니며, 1인 운영에서는 Zero Trust 정책 오조작으로 **자기 대시보드에서 잠기는** 위험이 실재한다.

**정작 공격 표면을 덮지 못한다.** 위험한 경로는 브라우저 UI가 아니라 기계 호출부다.

- `POST /api/webhooks/deployment` — GitHub Webhook은 커스텀 헤더를 실을 수 없다. Access 서비스 토큰 전달 수단이 없어 **Bypass 규칙이 강제**된다.
- `/api/v1/*` — CLI 호출부. 서비스 토큰을 쓸 수는 있으나 이미 등록 토큰 체계를 만드는 중이라 인증 경로가 둘로 갈라진다.

결국 Access는 화면만 덮고 API는 뚫린 채 남는다.

**앱 인증을 대체하지 못한다.** 승인자와 토큰 발급자를 기록하려면 앱 안에 사용자 개념이 필요하다. Access를 넣어도 Auth.js는 빠지지 않는다.

### 3.1 채택안

| 위협 | 대응 |
|---|---|
| 무단 브라우저 접근 | Auth.js GitHub OAuth + `ALLOWED_GITHUB_LOGINS` 화이트리스트. 목록에 없으면 세션을 발급하지 않는다 |
| 세션 탈취 | 쿠키 `httpOnly` + `secure` + `SameSite=Lax`, 세션 수명 단축 |
| Webhook 위조 | HMAC-SHA256 서명 + 타임스탬프 유효창 5분 |
| CLI 무단 등록 | 10분·1회용 토큰, scope·repository 제약, SHA-256 해시만 저장 |
| 스캐너·무차별 대입 | Caddy 레이트리밋, `/api/*`에 별도 한도 |
| 포트 노출 | UFW 80/443만 개방. postgres·socket-proxy는 Docker 내부 네트워크 전용, 호스트 포트 매핑 없음 |
| IP 직접 접근 | Caddy가 설정된 호스트명에만 응답. `https://<VPS-IP>` 요청은 빈 응답으로 끊는다 |

### 3.2 DNS는 가비아 — 프록시 계층이 없다

도메인을 가비아에서 운영하므로 Cloudflare 프록시(주황 구름)가 주던 두 가지가 없다.

- **오리진 IP 은닉 없음** — A 레코드에 VPS 공인 IP가 그대로 노출된다. 대량 스캐너가 반드시 찾아온다
- **DDoS 흡수 없음** — Hostinger VPS가 직접 받는다

대가로 얻는 것도 있다. Cloudflare의 SSL 모드(Flexible/Full/Full Strict) 오설정 문제가 없고, Caddy가 Let's Encrypt **HTTP-01**로 인증서를 직접 받아 갱신한다. DNS-01은 쓰지 않으므로 **DNS 제공자 API 연동이 전혀 필요 없다** — 가비아 API 의존이 생기지 않는다.

IP 노출에 대한 실질 방어는 위 표의 마지막 줄이다. Caddy를 설정된 호스트명에만 응답하도록 두면 IP로 직접 두드리는 스캐너는 앱에 닿지 못한다. IP 자체를 감추지는 못하지만, 자동화 스캐닝의 대부분은 여기서 걸린다.

**남는 리스크:** Next.js 프리인증 취약점이 터지면 로그인 앞단이 노출되며, 프록시가 없어 이 노출이 계획서 원안보다 크다. 9절 R6에서 다룬다.

### 3.3 Tailscale 전환 경로 (보류, 필요 시)

공개 노출이 부담스러워지면 아래로 바꾼다. **지금 채택하지 않지만 설계가 이 전환을 막지 않도록 둔다.**

```
공개 :443   caddy → /api/webhooks/*  만          (HMAC 검증)
tailnet     caddy → 나머지 전부                   (UI · CLI API)
```

공개 표면이 웹훅 하나로 줄고 오리진 IP 노출 문제가 사라진다. 조건은 CLI를 쓰는 개발 머신이 항상 tailnet에 있어야 한다는 것이다. 전환에 필요한 변경은 Caddyfile의 바인딩 분리뿐이므로 애플리케이션 코드는 영향받지 않는다 — 그래서 지금 결정하지 않아도 된다.

---

## 4. 런타임 아키텍처

```
가비아 DNS  (A 레코드 → VPS 공인 IP · 프록시 없음)
        │  :443
        ▼
┌─ Hostinger VPS ──────────────────────────────────┐
│                                                   │
│  caddy       HTTPS(Let's Encrypt HTTP-01)          │
│              레이트리밋 · 호스트명 미일치 차단        │
│      │                                            │
│      ▼                                            │
│  deployhub-web      Next.js  UI + REST API + Hook  │
│  deployhub-worker   동일 이미지 · 다른 command      │
│      │        │                                   │
│      ▼        ▼                                   │
│  postgres:17   socket-proxy  (read-only Docker API)│
│                     │                             │
└─────────────────────┼─────────────────────────────┘
                      ▼            worker ──▶ 외부 Provider API
              /var/run/docker.sock         GitHub · Vercel
                                           Supabase · Hostinger
```

컨테이너 5개. 계획서 8.2 기본안에서 uptime-kuma를 빼고 socket-proxy를 더한 결과다.

**web과 worker는 같은 이미지다.** 하나의 멀티스테이지 Dockerfile에서 Next standalone 산출물과 worker 번들을 함께 빌드하고, compose에서 `command`로 갈라진다. 분리 비용이 실질 0인 반면, 외부 Provider 응답이 30초 걸려도 화면이 영향을 받지 않는 이득은 크다. 관측이 이 시스템의 중심이므로 이 분리는 선택이 아니라 전제다.

**web에는 Docker socket을 일절 물리지 않는다.** worker가 `http://socket-proxy:2375`로 HTTP 조회한다. socket-proxy 권한은 `CONTAINERS=1 IMAGES=1 NETWORKS=1 VOLUMES=1 INFO=1`, 나머지와 `POST`는 전부 0이다. 계획서 12.2·21.2의 요구를 컨테이너 하나로 충족한다.

### 4.1 compose 골자

```yaml
services:
  web:
    image: deployhub:${TAG}
    command: ["node", "apps/web/server.js"]
    depends_on: { postgres: { condition: service_healthy } }
    labels:
      deployhub.project: "deployhub"
      deployhub.component: "web"
      deployhub.environment: "production"

  worker:
    image: deployhub:${TAG}          # 동일 이미지
    command: ["node", "apps/worker/index.js"]
    depends_on: { postgres: { condition: service_healthy } }
    labels:
      deployhub.project: "deployhub"
      deployhub.component: "worker"

  postgres:
    image: postgres:17-alpine        # 호스트 포트 매핑 없음
    volumes: [postgres_data:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U deployhub -d deployhub"]

  socket-proxy:
    image: tecnativa/docker-socket-proxy
    environment:
      CONTAINERS: 1
      IMAGES: 1
      NETWORKS: 1
      VOLUMES: 1
      INFO: 1
      POST: 0                        # 생성·삭제·exec 전면 차단
    volumes: ["/var/run/docker.sock:/var/run/docker.sock:ro"]

  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443"]      # 외부 노출은 이 둘뿐
```

DeployHub 자신도 계획서 13절의 Label 표준을 따른다. 자기 자신을 첫 관리 대상으로 삼아야 Label 매칭이 실제로 동작하는지 매일 확인된다.

---

## 5. 기술 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| 모노레포 | pnpm workspace | 앱 2개. Turbo는 앱이 늘면 그때 |
| 프레임워크 | Next.js App Router + TypeScript | 계획서 9.1 유지 |
| ORM | Drizzle | 계획서 9.2 권장 유지. JSONB와 `SKIP LOCKED`를 직접 통제 |
| DB | PostgreSQL 17 + `pg_trgm` | 검색용. `pgvector`는 현 시점 불필요 |
| Job | `jobs` 테이블 + `FOR UPDATE SKIP LOCKED` 폴링 | worker 단일 인스턴스 |
| 스케줄 | worker 코드 내 cron 정의 → `jobs` enqueue | 외부 스케줄러 불필요 |
| 사람 인증 | Auth.js + GitHub OAuth + 로그인 화이트리스트 | 3절 |
| CLI 인증 | 10분·1회용 등록 토큰 (SHA-256 해시 저장) | 계획서 38.2 |
| 웹훅 인증 | HMAC-SHA256 + 타임스탬프 창 | OIDC는 M5 |
| 토큰 암호화 | AES-256-GCM, 키는 `.env` 분리 | 계획서 21.1 |
| 알림 | Telegram Bot API 직접 호출 | Uptime Kuma 제외에 따름 |
| UI | Tailwind + shadcn/ui, `DESIGN-raycast.md` 토큰 | 계획서 17 |

### 5.1 저장소 구조

```
deployhub/
├─ apps/
│  ├─ web/          Next.js — UI, REST API, Webhook
│  └─ worker/       장기 실행 — 폴링, 수집, 헬스체크, 이벤트 감지, 알림
├─ packages/
│  ├─ db/           Drizzle 스키마 · 마이그레이션 · 쿼리
│  ├─ collectors/   ProviderCollector 인터페이스 + 구현
│  ├─ fingerprint/  의존성 지문 규칙 엔진 (6절)
│  ├─ manifest/     Zod 스키마 · JSON Schema 생성 · validator · diff
│  ├─ cli/          @deployhub/cli
│  └─ shared/       타입 · 에러 · 로거 · 암호화
├─ docker/          Dockerfile · compose.yml · Caddyfile · backup/
├─ drizzle/
├─ docs/
└─ deployhub.yaml   자기 자신의 manifest
```

---

## 6. 의존성 지문 — 뒷단 파악의 주된 수단

"이 프로젝트가 뒷단에 무엇을 쓰는가"는 사람이 입력하면 반드시 낡는다. Provider API에서 나오는 두 가지 신호로 자동 추론한다.

### 6.1 신호 1 — 환경변수 **이름**

Vercel API가 프로젝트 환경변수의 이름·타입·target을 반환한다. **값은 조회하지 않고 저장하지도 않는다**(계획서 11.1). 값은 필요 없다. 이름만으로 뒷단이 드러난다.

```
SUPABASE_URL, SUPABASE_ANON_KEY   → Supabase (DB · Auth · Storage)
DATABASE_URL=postgres://…          → PostgreSQL (직접 운영 또는 관리형)
UPSTASH_REDIS_REST_URL             → Upstash Redis
BLOB_READ_WRITE_TOKEN              → Vercel Blob
RESEND_API_KEY                     → Resend (외부 API)
STRIPE_SECRET_KEY                  → Stripe (외부 API)
```

VPS Docker 쪽은 같은 신호를 compose의 `environment` 키와 Docker Label에서 얻는다.

### 6.2 신호 2 — 의존성 목록

GitHub Contents API로 `package.json`(또는 `requirements.txt`, `pyproject.toml`, `go.mod`)을 읽는다.

```
@supabase/supabase-js  → Supabase
drizzle-orm / prisma   → ORM
ioredis / @upstash/redis → Redis
@aws-sdk/client-s3     → S3 호환 스토리지
next-auth              → 인증
```

### 6.3 규칙 엔진과 신뢰도

`packages/fingerprint`가 규칙 테이블을 들고 두 신호를 매칭한다. 규칙 하나의 형태는 다음과 같다.

```ts
{
  id: "supabase",
  produces: { component_type: "database", provider: "supabase" },
  envPatterns: [/^SUPABASE_URL$/, /^NEXT_PUBLIC_SUPABASE_/],
  dependencies: ["@supabase/supabase-js"],
}
```

신뢰도는 **몇 개 신호가 맞았는지**로 정한다.

| 조건 | `origin` | 화면 처리 |
|---|---|---|
| 환경변수 + 의존성 모두 일치 | `detected` | 그대로 반영 |
| 둘 중 하나만 일치 | `inferred` | 강조 표시, 확인 요청 |
| 사람이 확정 | `declared` | 이후 자동 추론이 덮어쓰지 않음 |

**추론 결과는 컴포넌트를 자동 생성하지 않고 제안한다.** 확인 한 번을 거쳐 `components`에 들어간다. 근거(`evidence`)는 항상 함께 저장하므로 "왜 Supabase라고 판단했는가"에 언제나 답할 수 있다.

이 엔진은 계획서 34절의 CLI 로컬 탐지 로직과 규칙을 **공유**한다. 같은 규칙 테이블을 CLI(로컬 파일 대상)와 worker(Provider API 대상)가 함께 쓴다. 그래서 `packages/fingerprint`가 `cli`가 아니라 최상위 패키지다.

---

## 7. 데이터 모델

계획서 31개 테이블에서 14개로 줄인다. 소유권을 고정하는 것이 핵심이다 — 어느 테이블에 누가 쓰는지가 정해지면 Drift가 자연히 계산된다.

### 7.1 선언 영역 — 사람과 CLI만 기록

```
users                GitHub OAuth 계정
projects             name, slug, description, status, lifecycle,
                     importance, owner, archived_at
components           project_id, name, slug, component_type, framework,
                     runtime, language, criticality,
                     field_sources JSONB          ← 신설
domains              project_id, component_id, domain, environment,
                     dns_provider, ssl_expires_at, last_checked_at
component_resources  component_id, resource_id, environment,
                     relation_type, is_primary, linked_by,   ← linked_by 신설
                     UNIQUE(component_id, resource_id, environment)
```

**`components.field_sources`** — 계획서 34.3의 신뢰도 구분과 6.3의 지문 근거를 담는다. 별도 테이블로 정규화하지 않는다. 조회가 항상 컴포넌트 단위라 정규화 이득이 없다.

```json
{
  "framework": { "origin": "detected", "evidence": "next@16.1.0", "source": "package.json" },
  "provider":  { "origin": "detected", "evidence": "SUPABASE_URL + @supabase/supabase-js" },
  "criticality": { "origin": "inferred", "evidence": "AI 추론" }
}
```

**`component_resources.linked_by`** — 계획서 14.2("자동 이름 매칭만으로 즉시 연결하지 않는다")를 지키는 장치.

| 값 | 의미 | 즉시 연결 |
|---|---|---|
| `manifest` | `deployhub.yaml`의 명시적 선언 | 예 |
| `label` | Docker Label의 명시적 선언 | 예 |
| `repository` | 저장소 일치 (8절 그룹핑) | 예 |
| `user` | 화면에서 사람이 연결 | 예 |
| `suggested` | 이름 유사도 기반 후보 | **아니오** — 확인 대기 |

Label과 저장소 일치는 사용자가 직접 적은 정보이므로 즉시 연결해도 원칙에 어긋나지 않는다. 추측으로 만든 링크만 `suggested`로 격리한다.

### 7.2 관측 영역 — worker만 기록

```
resources            provider, provider_account_id(nullable), external_id,
                     resource_type, name, status, region, url,
                     metadata JSONB, first_seen_at, last_seen_at, deleted_at
                     UNIQUE(provider, external_id)
container_snapshots  resource_id, cpu_pct, mem_bytes, restart_count, observed_at
health_checks        project_id, component_id, resource_id, check_type,
                     target, current_status, response_time_ms,
                     failure_count, error_message, checked_at
deployments          project_id, component_id, provider, environment,
                     version, commit_sha, image_name, status,
                     deployment_url, started_at, completed_at, metadata JSONB
```

`resources.provider_account_id`는 nullable이다. 로컬 Docker 수집은 Provider 계정 없이 이뤄지므로 계정 행을 억지로 만들지 않고 `provider = 'docker'`로 식별한다.

`container_snapshots`를 `resources.metadata`에 넣지 않고 분리한 이유는 시계열이기 때문이다. 갱신이 아니라 누적이며 보존 기간(14일)을 두고 잘라낸다.

### 7.3 변경 이벤트 — 이 시스템의 중심 테이블

평소엔 화면을 보지 않고 상태 변화만 받는 사용 방식에서, **무엇이 언제 바뀌었는가**가 시스템의 산출물이다.

```
change_events   id, project_id(nullable), entity_type, entity_id,
                event_type, severity, from_value, to_value,
                message, observed_at, notified_at, resolved_at
```

worker가 수집 결과를 이전 상태와 비교해 전이가 있을 때만 한 줄 넣는다.

| `event_type` | 발생원 |
|---|---|
| `deployment_succeeded` / `deployment_failed` | Vercel, GitHub Actions, 배포 웹훅 |
| `container_started` / `container_stopped` / `container_restarting` | Docker |
| `container_image_changed` | Docker (이미지 태그 전이) |
| `health_up` / `health_down` | HTTP 헬스체크 |
| `resource_appeared` / `resource_disappeared` | 모든 Collector |
| `ssl_expiring` | 도메인 점검 |
| `provider_sync_failed` | Collector 실패 |
| `drift_detected` | 선언·관측 불일치 |

이 테이블 하나가 세 가지를 동시에 받친다.

```
change_events ─┬─▶ severity 기준 Telegram 즉시 알림 → notified_at 기록
               ├─▶ 아침 일별 요약 (지난 24시간 집계)
               └─▶ 프로젝트 상세의 변경 타임라인
```

`alerts`를 별도 테이블로 두지 않는 이유가 이것이다. 알림은 이벤트의 속성(`notified_at`)이지 별개 개체가 아니며, 분리하면 같은 사건이 두 테이블에 나뉘어 타임라인 조회가 조인 하나 더 필요해진다.

### 7.4 운영 영역

```
jobs                 type, payload JSONB, status, run_at, attempts,
                     locked_at, locked_by, last_error
provider_accounts    provider, name, encrypted_token, scopes,
                     last_verified_at, last_sync_at, last_error
registration_tokens  token_hash, scope, repository_constraint,
                     project_slug_constraint, expires_at,
                     max_uses, used_count, created_by, revoked_at
project_drafts       project_id(nullable), manifest_version, manifest_yaml,
                     source_type, submitted_by_type, submitted_by_id,
                     status, validation_result_json, diff_json,
                     reviewed_by, reviewed_at
```

`project_drafts.status`는 계획서 39절의 여섯 상태를 따른다: `draft`, `validation_failed`, `pending_review`, `approved`, `rejected`, `superseded`.

### 7.5 Drift는 테이블이 아니다

선언과 관측을 조인하는 **파생 쿼리**로 계산한다. 저장하면 반드시 낡는다. 화면 진입 시 계산하고, 알림이 필요한 종류만 `change_events`에 `drift_detected`로 승격한다.

```
Declared  deployhub.yaml 또는 components의 선언값
Observed  resources(docker_container).metadata.image
Result    불일치 → Configuration Drift
```

**합계 14개 테이블.** 선언 5 · 관측 4 · 이벤트 1 · 운영 4.

---

## 8. 마일스톤

계획서 46절의 17항목을 4개로 재편한다. **관측을 앞에, 선언 도구를 뒤에** 둔 것이 계획서와의 가장 큰 차이다.

배포처가 Vercel과 VPS 절반씩이므로 두 Collector를 한 마일스톤에서 병행한다. 그 앞에 GitHub이 오는 이유는 **저장소가 모든 것의 조인 키**이기 때문이다 — Vercel 프로젝트는 자기 git repo를 알고, Docker Label에도 `deployhub.repository`가 있다. 저장소를 축으로 놓으면 흩어진 자원이 프로젝트로 묶인다.

### M1 · 뼈대와 GitHub

- pnpm workspace, 공용 멀티스테이지 Dockerfile
- compose(web / worker / postgres / caddy), Caddy HTTPS·레이트리밋, UFW 80/443
- Drizzle 스키마 v1 — `users`, `projects`, `components`, `resources`, `component_resources`, `provider_accounts`, `jobs`
- Auth.js GitHub OAuth + `ALLOWED_GITHUB_LOGINS` 화이트리스트
- `DESIGN-raycast.md` 토큰을 Tailwind 설정으로 이관, Sidebar 240px 레이아웃
- `jobs` + `FOR UPDATE SKIP LOCKED` 폴링, worker cron 스케줄
- **GitHub Collector** — 저장소, 기본 브랜치, 언어, 토픽, 최근 커밋, Actions Workflow Run
- **저장소 기준 프로젝트 자동 그룹핑** 제안 → 확인 UI (`linked_by = 'repository'`)
- 프로젝트·구성요소 CRUD, 목록, 상세

> **완료 기준** — 저장소 전체가 목록에 뜨고, 각 저장소의 마지막 커밋과 마지막 워크플로 결과가 보이며, 프로젝트 단위로 묶여 있다.

### M2 · Vercel + Docker 병행, 뒷단 파악

- **Vercel Collector** — 프로젝트, 프레임워크, 연결 git repo, 프로덕션 도메인, 배포 이력, **환경변수 이름과 scope**
- **Docker Collector** — socket-proxy 추가, 컨테이너·이미지·네트워크·볼륨, Label, Compose 프로젝트
- Docker Label 매칭(`linked_by = 'label'`), 이름 유사도 후보(`suggested`), Unlinked 목록
- **`packages/fingerprint`** — 6절의 규칙 엔진. 환경변수 이름 + 의존성 → 뒷단 시스템 추론 → 컴포넌트 제안
- 저장소를 축으로 3자 자동 연결 (GitHub repo ↔ Vercel project ↔ Docker label)
- **최종 배포 통합 뷰** — Vercel 배포 이력과 Docker 이미지 태그·시작 시각을 한 줄로
- `container_snapshots` 수집

> **완료 기준** — 각 프로젝트의 뒷단 구성(DB·인증·스토리지·캐시·외부 API)과 최종 배포 시각·커밋이 한 화면에 보인다. 1.1의 질문 1과 3에 답한다.

### M3 · 모니터링과 알림

- HTTP 헬스체크 5분 · 컨테이너 상태 1분 · SSL 만료 점검 1일 (**TLS 핸드셰이크로 실제 서빙 인증서를 관측**. DNS 제공자 API 미사용)
- **`change_events` 기록과 상태 전이 감지** (7.3)
- Telegram 즉시 알림 — 장애, 배포 실패, 컨테이너 중지·반복 재시작, SSL 30일 이내, Provider 동기화 실패, 디스크 85%·메모리 90% 초과
- **아침 일별 요약** — 지난 24시간 `change_events` 집계 1건 발송
- 변경 타임라인 화면 (전체 / 프로젝트별)
- 대시보드 Summary Card, 계획서 18.3의 정상·주의·장애·미확인 판정
- 외부 dead man's switch 등록 (R7)

> **완료 기준** — 화면을 보고 있지 않아도 문제 발생 시 Telegram으로 받고, 아침에 어제 변경 요약을 받는다. 1.1의 질문 2에 답한다.

### M4 · 나머지 Provider와 선언 도구

- **Supabase Collector** — 프로젝트, region, DB 버전, Auth·Storage·Realtime 사용 여부
- **Hostinger Collector** — VPS 상태, IP, plan, CPU·메모리·디스크, 백업 상태
- `packages/manifest` — Zod v1 스키마, JSON Schema 생성, validator (9절 R1)
- `packages/cli` — `init --detect`, `validate`, `register --draft`, `diff`, `sync --draft`
- 일회용 등록 토큰, `project_drafts` 검토·승인 화면, `AGENTS.md` 템플릿
- Drift 표시(7.5), 배포 웹훅(HMAC), Command Palette (`Ctrl+K`)

> **완료 기준** — 계획서 4.1의 질문 전부에 답하고, AI에게 "이 프로젝트 DeployHub에 등록해줘"가 동작한다.

**CLI가 M4로 밀린 이유.** 관측이 먼저 들어오면 프로젝트 정보가 스스로 갱신되므로 카탈로그 부패 위험이 낮아진다. 그 상태에서 CLI의 역할은 "등록"이 아니라 **관측으로 알 수 없는 것을 채우는 것** — 설명, 목적, 담당자, 중요도, 그리고 아직 배포되지 않은 신규 프로젝트다. 우선순위가 자연히 뒤로 간다.

### 보류 — M5 이후

Device Login(계획서 38.3) · GitHub Actions OIDC(40) · MCP Server(41) · React Flow 아키텍처 그래프(16.4) · 비용 메타데이터 · 월간 운영 리포트 · 운영 Score · Tailscale 전환(3.3)

**계획서 11.5의 Cloudflare Collector는 목록에서 제외한다.** DNS를 가비아에서 운영하므로 수집 대상이 없다. 도메인과 DNS 정보는 화면에서 수동 등록하고, SSL 만료일은 DNS 제공자 API가 아니라 **실제 TLS 핸드셰이크로 관측**한다(M3). 이 방식이 오히려 정확하다 — 등록된 값이 아니라 지금 실제로 서빙되는 인증서를 보기 때문이다.

---

## 9. 리스크와 대응

| # | 리스크 | 대응 |
|---|---|---|
| R1 | **CLI 스키마 버전 스큐** — 구버전 CLI가 낡은 캐시로 검증해 잘못된 YAML을 통과시킨다 | Zod가 유일한 원본. CLI는 스키마를 자체 보관하지 않고 실행 시 서버에서 fetch(ETag 캐시). 서버가 `X-Manifest-Version` 응답, 불일치 시 캐시 폐기. **서버측 재검증을 생략하지 않는다** — CLI는 신뢰할 수 없는 클라이언트다 |
| R2 | **기존 프로젝트에 Docker Label이 없다** — 자동 매칭이 아무것도 못 잡는다 | 저장소 기준 그룹핑(M1)이 Label 없이도 대부분을 묶는다. 나머지는 Unlinked 목록에서 수동 매핑. Label은 프로젝트를 손댈 때마다 점진 적용 |
| R3 | **의존성 지문 오탐** — 안 쓰는 잔재 의존성이나 devDependency를 실사용으로 오인 | 두 신호(환경변수 + 의존성) 동시 일치만 `detected`. 하나만 맞으면 `inferred`로 강조. 자동 생성하지 않고 제안만 한다. 사람이 확정하면 `declared`가 되어 이후 추론이 덮어쓰지 않는다 |
| R4 | **환경변수 값의 실수 저장** — 이름만 쓰겠다고 해놓고 값이 흘러들어간다 | Collector 파싱 단계에서 `value` 필드를 즉시 폐기. 이 동작을 테스트로 고정(10절). `resources.metadata`에 값이 없음을 단언하는 테스트를 둔다 |
| R5 | **Provider 토큰 권한 과다** — 관리 목적에 쓰기 권한이 딸려온다 | 가능한 모든 Provider에서 read-only 토큰. `provider_accounts.scopes`에 실제 부여 범위를 기록하고, 화면에서 과다 권한을 경고 |
| R6 | **Next.js 프리인증 취약점** — Access도 프록시도 없으므로 로그인 앞단이 공인 IP에 그대로 노출된다. 계획서 원안보다 노출이 크다 | 보안 패치 지연 없이 적용(Dependabot). 호스트명 미일치 차단(3.1). **부담되면 Tailscale 전환** — UI와 CLI API를 tailnet 전용으로 옮기고 `/api/webhooks/*`만 공개하면 공개 표면이 웹훅 하나로 줄고 IP 노출 문제가 소멸한다. 전환 경로를 3.3에 남긴다 |
| R12 | **레이트리밋 미적용 (부채)** — 3.1이 완화책으로 잡았던 Caddy 레이트리밋이 실제 배포 환경에 적용되지 않았다. 배포 대상 VPS는 이 문서가 전제한 전용 서버가 아니라 5개 서비스가 공유하는 서버이고, 공용 Caddy가 stock `caddy:2`라 `rate_limit` 모듈이 없다. 모듈을 넣으려면 공용 이미지를 교체해야 하는데 그러면 무관한 서비스 5개가 재기동된다 | **현 시점 감수한다.** DeployHub의 실질 방어선은 GitHub OAuth 화이트리스트이고, 비밀번호가 없어 무차별 대입 대상이 아니다. 남는 위험은 스캐너 트래픽뿐이다. 되살리려면 두 경로가 있다 — ① 공용 Caddy를 `caddy-ratelimit` 포함 이미지로 교체(전 프로젝트가 함께 사용 가능, 재기동 필요) ② DeployHub 전용 Caddy를 호스트 포트 없이 `web` 네트워크에 두고 공용 Caddy가 체이닝(다른 프로젝트 무영향, 컨테이너·홉 각 1개 추가). ②의 이미지 빌드 정의는 `docker/Caddyfile.Dockerfile`에 이미 있고 `standalone` 프로파일로 보존돼 있다 |
| R7 | **감시자를 감시할 자가 없다** — Uptime Kuma를 뺐고 VPS가 죽으면 알림도 죽는다 | worker가 외부 무료 dead man's switch(healthchecks.io 등)로 주기 heartbeat 전송. 신호가 끊기면 외부가 알린다. M3 포함 |
| R8 | **알림 피로** — 같은 장애로 5분마다 Telegram이 울리면 곧 무시하게 된다 | `change_events`는 **전이할 때만** 기록한다. 같은 상태 지속은 이벤트가 아니다. 복구 시 `resolved_at`을 채우고 복구 알림 1건. 일별 요약은 집계 1건 |
| R9 | **암호화 키와 백업의 동거** — AES 키가 DB 덤프와 같은 곳에 있으면 암호화가 무의미하다 | DB 덤프는 외부 오브젝트 스토리지, 키는 별도 채널(패스워드 매니저). 백업 스크립트가 `.env`를 포함하지 않도록 명시 |
| R10 | **단일 VPS SPOF** | 이 규모에서 다중화는 과잉. 대신 복구 시간을 줄인다 — 9.1의 백업과 분기 1회 복구 리허설 |
| R11 | **다중 사용자 전환 시 Server Action의 권한 구멍** — 현재 Server Action은 `auth()` 세션 유무만 확인하고 프로젝트 소유권은 보지 않는다. 사용자 1~2명 전원이 모든 프로젝트의 운영자인 지금은 넘을 경계가 없어 문제가 아니다. 그러나 `ALLOWED_GITHUB_LOGINS`에 신뢰 수준이 다른 사람이 추가되거나 `projects.owner`를 FK로 승격하는 순간 IDOR이 된다 | **전환 시 반드시 함께 고칠 것.** 대상은 `apps/web/src/actions/`의 **모든 Action**이다. 세션 확인 뒤에 대상 리소스의 프로젝트 소유권을 검사하는 단계를 추가한다. `id`로 대상을 찾는 Action(`updateProject`·`archiveProject`·`updateComponent`·`deleteComponent`·`removeResourceLink`)은 소유권 조건을 `WHERE`에 함께 넣어 비소유자의 조작이 0행에 영향하게 만들고, 부모 id를 인자로 받는 Action(`createComponent`·`confirmResourceLink`)은 그 id에 대한 권한을 먼저 확인한다. **새 Action을 추가할 때마다 이 목록에 넣는다.** 2026-07-26 자동 보안 검토가 `components.ts`와 `links.ts`에서 각각 지적했고, 당시 조건에서는 미적용으로 판단했다 |

### 9.1 백업 (계획서 20절 축소본)

| 대상 | 주기 | 보관처 |
|---|---|---|
| PostgreSQL `pg_dump` | 매일 | Backblaze B2 또는 S3 호환 스토리지 |
| compose·Caddyfile | 변경 시 | Git 저장소 |
| `.env` | 변경 시 | 패스워드 매니저 (**백업 스토리지 아님**) |
| 암호화 키 | 변경 시 | 패스워드 매니저 |

동일 VPS 내부에만 보관하지 않는다. **분기 1회 복구 리허설**을 수행한다 — 검증하지 않은 백업은 백업이 아니다.

---

## 10. 검증 방법

자동 테스트는 회귀 비용이 실제로 큰 곳에만 둔다.

| 대상 | 방법 | 이유 |
|---|---|---|
| `packages/fingerprint` | 규칙별 단위 테스트 + 실제 프로젝트 픽스처(env 이름 목록 + package.json) | 뒷단 파악의 정확도가 이 시스템의 값어치다. 오탐은 조용히 쌓인다 |
| Collector 파싱 | Provider API 응답 픽스처 → 정규화 결과 스냅샷. **환경변수 값 미저장 단언 포함** | R4를 테스트로 고정한다 |
| `change_events` 전이 감지 | 이전 상태·현재 상태 조합 테이블 테스트 | 오탐은 알림 신뢰를, 미탐은 시스템 존재 이유를 무너뜨린다 |
| Drift 계산 | 선언·관측 조합 픽스처 | 상동 |
| `packages/manifest` | Zod 스키마 + valid/invalid YAML 픽스처 | AI가 만든 YAML을 사람이 정독하지 않고 승인한다. 스키마가 마지막 방어선 |
| CLI detectors | 픽스처 프로젝트 폴더 → 기대 manifest 스냅샷 | 탐지 로직은 조용히 틀린다 |
| REST API | Testcontainers PostgreSQL 통합 테스트 | 인증·권한 경계 회귀 방지 |
| 화면 | 수동 | 1인 운영에서 E2E 유지 비용이 이득을 넘는다 |

---

## 11. 확정 요약

```
목적      ① 각 프로젝트의 뒷단 시스템 파악
          ② 상태 변화 시 알림 + 일별 변경 점검
          ③ 깃 연동과 최종 배포 확인
          → 셋 다 관측으로 답한다. 선언 도구는 뒤로.

런타임    컨테이너 5개  web / worker / postgres / caddy / socket-proxy
          web·worker 동일 이미지, command로 분리
          web에 Docker socket 미연결

스키마    테이블 14개  선언 5 · 관측 4 · 이벤트 1 · 운영 4
          change_events가 알림·일별요약·타임라인을 모두 받친다
          Drift는 파생 쿼리, 저장하지 않음

뒷단파악  환경변수 이름 + 의존성 목록 → 규칙 엔진 → 컴포넌트 제안
          두 신호 일치 = detected, 하나만 = inferred
          값은 조회도 저장도 하지 않음

인증      사람  Auth.js GitHub OAuth + 화이트리스트
          CLI   10분·1회용 등록 토큰
          웹훅  HMAC-SHA256
          Cloudflare 전면 미사용 (Access도, 프록시도)

DNS       가비아. A 레코드 → VPS 공인 IP, 프록시 계층 없음
          Caddy가 Let's Encrypt HTTP-01로 인증서 직접 발급
          DNS 제공자 API 의존 없음
          오리진 IP 노출은 감수 · Caddy 호스트명 차단으로 완화
          부담 시 Tailscale 전환 경로 확보 (3.3)

순서      M1 뼈대+GitHub → M2 Vercel+Docker+지문 → M3 모니터링·알림 → M4 나머지+CLI
          저장소가 모든 것의 조인 키

제외      Uptime Kuma · Redis · Turborepo · teams 권한모델 · audit_logs
          alerts 테이블 · 별도 collector 컨테이너
          Device Login · OIDC · MCP (M5 이후)
```

---

## 12. 다음 단계

이 문서는 *무엇을 어떻게 만들지*를 확정했다. 다음은 M1을 파일 단위 작업으로 분해한 구현 계획이다.
