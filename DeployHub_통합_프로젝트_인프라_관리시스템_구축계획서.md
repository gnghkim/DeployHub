# DeployHub 통합 프로젝트·인프라 관리 시스템 구축계획서

> **배포 기준:** Hostinger VPS 단독 자가 호스팅  
> **운영 방식:** Docker Compose 기반 컨테이너 배포  
> **UI 기준:** `DESIGN-raycast.md`의 Raycast 계열 다크 개발자 도구 디자인  
> **문서 버전:** v3.0
> **주요 변경:** AI 기반 프로젝트 등록, Manifest Schema, DeployHub CLI, 단기 인증, Device Login, GitHub OIDC 및 MCP 확장계획 반영

---

## 1. 프로젝트 개요

현재 여러 웹서비스와 웹앱을 Vercel, Hostinger VPS, Supabase, GitHub 등에 분산하여 운영하고 있다.

각 프로젝트마다 사용하는 프론트엔드, 백엔드, 데이터베이스, 저장소, 도메인, 배포 위치와 운영 방식이 다르기 때문에 다음 정보를 한 번에 파악하기 어렵다.

- 어떤 프로젝트가 운영 중인지
- 각 프로젝트가 어떤 기술 스택을 사용하는지
- 프론트엔드와 백엔드가 어디에 배포되어 있는지
- 어떤 Vercel 프로젝트, Supabase 프로젝트, VPS, Docker Container와 연결되어 있는지
- 최근 배포가 성공했는지
- 현재 서비스와 서버가 정상인지
- 특정 VPS 또는 외부 서비스 장애가 어떤 프로젝트에 영향을 주는지
- 더 이상 사용하지 않는 프로젝트와 인프라 자원이 무엇인지

이를 해결하기 위해 프로젝트, 애플리케이션 구성요소, 배포 대상, 인프라 자원, 도메인, 외부 서비스, 배포 이력과 모니터링 상태를 통합 관리하는 내부 웹 시스템을 구축한다.

시스템 가칭은 다음과 같다.

> **DeployHub**  
> 프로젝트별 기술 스택, 배포 환경, 서버, Docker Container, 데이터베이스, 도메인, 외부 서비스와 운영 상태를 통합 관리하는 내부 개발자 포털

---

## 2. 구축 방향

DeployHub는 Vercel에 배포하거나 Supabase를 관리 데이터베이스로 사용하는 방식이 아니라, Hostinger VPS 한 대에 Docker Compose로 자가 호스팅한다.

다만 DeployHub가 관리하는 대상에는 다음 외부 서비스가 포함될 수 있다.

- Vercel
- Supabase
- Hostinger VPS
- GitHub
- Cloudflare
- Railway
- 기타 외부 API 서비스

즉, **DeployHub 자체는 Hostinger VPS에서 독립적으로 운영하고 외부 서비스는 API로 조회·연동**한다.

---

## 3. 오픈소스 참고 방향

DeployHub를 특정 오픈소스 하나를 그대로 Fork하여 구축하지 않고, 여러 프로젝트의 장점을 조합한다.

| 참고 프로젝트 | 반영할 개념 |
|---|---|
| Backstage | 프로젝트·서비스·API·DB·담당자 중심의 Software Catalog |
| FrontStage | 경량 서비스 카탈로그, YAML 기반 등록 방식 |
| Coolify | VPS, Git 저장소, Docker 앱, 도메인과 배포 관리 구조 |
| Dokploy | Docker Compose 기반 애플리케이션·DB·서버 관리 UI |
| Uptime Kuma | URL, HTTP, TCP, SSL, Push 방식 모니터링 |
| NetBox | 서버·IP·도메인·인프라 자원 모델 |
| Fix Inventory | 외부 Provider별 Collector와 공통 자원 정규화 구조 |
| Homepage | 서비스 카드와 빠른 상태 확인 대시보드 UI |

### 3.1 핵심 적용 원칙

```text
Backstage
  └─ 프로젝트와 서비스 카탈로그 구조

Coolify / Dokploy
  └─ 서버, Docker, 배포, 도메인 관리 구조

Uptime Kuma
  └─ 상태 점검과 알림

Fix Inventory
  └─ Vercel, Supabase, Hostinger, GitHub Collector 구조

Raycast 디자인
  └─ 전체 UI와 디자인 시스템
```

---

## 4. 구축 목표

### 4.1 1차 목표

DeployHub에 접속했을 때 모든 프로젝트에 대해 다음 질문에 즉시 답할 수 있어야 한다.

> 이 프로젝트는 어떤 기술을 사용하고, 어디에 배포되어 있으며, 어떤 서버와 외부 서비스에 연결되어 있고, 현재 정상적으로 운영되고 있는가?

### 4.2 세부 목표

1. 프로젝트별 기술 스택 통합 관리
2. Frontend, Backend, API, Worker, Database 등의 구성요소 분리 관리
3. Vercel, Supabase, Hostinger, GitHub 자원 연결
4. Hostinger VPS와 Docker Container 자동 수집
5. 최근 배포와 Commit 정보 관리
6. 도메인, DNS, SSL 만료일 관리
7. URL과 API Health Check
8. 서버 CPU, 메모리, 디스크 상태 확인
9. 특정 자원 장애 시 영향 프로젝트 조회
10. 사용하지 않는 미연결 자원 탐지
11. 프로젝트 인수인계와 운영 문서 연결
12. 향후 비용·보안·백업 관리 기반 확보

---

## 5. 시스템 범위

## 5.1 관리 대상

### 프로젝트

- 웹사이트
- 웹앱
- 관리자 시스템
- API 서버
- 사내 업무 시스템
- 자동화 서비스
- Background Worker
- Batch 및 Scheduler
- 테스트 프로젝트

### 애플리케이션 구성요소

- Frontend
- Backend
- API
- Worker
- Scheduler
- Database
- Authentication
- Storage
- Cache
- Queue
- Monitoring

### 인프라 자원

- Hostinger VPS
- Docker Container
- Docker Image
- Docker Network
- Docker Volume
- Vercel Project
- Supabase Project
- GitHub Repository
- Domain
- DNS Zone
- SSL Certificate
- External API

---

## 5.2 1차 구축 제외 범위

초기 버전에서는 다음 운영 기능을 직접 수행하지 않는다.

- VPS 전원 종료 및 재부팅
- 외부 프로젝트 삭제
- Vercel 환경변수 수정
- Supabase 데이터베이스 설정 변경
- DNS Record 직접 변경
- Docker Container 강제 삭제
- 자동 롤백
- 통합 로그 전문 검색
- 프로젝트별 정확한 비용 정산

초기에는 **조회, 등록, 연결, 상태 확인과 알림 중심**으로 구축한다.

---

## 6. 핵심 데이터 모델

프로젝트와 인프라를 동일한 개념으로 관리하지 않는다.

```text
Project
  ├─ Component
  │    ├─ Deployment
  │    └─ Resource
  ├─ Repository
  ├─ Domain
  ├─ Document
  └─ Owner
```

### 6.1 예시

```text
LinkVault
 ├─ Web Frontend
 │   └─ Vercel Project
 ├─ API
 │   └─ Vercel Project
 ├─ Processing Worker
 │   └─ Hostinger VPS-01
 │       └─ linkvault-worker Container
 ├─ Database
 │   └─ Supabase PostgreSQL
 ├─ Authentication
 │   └─ Supabase Auth
 └─ Storage
     └─ Supabase Storage
```

### 6.2 다대다 관계

하나의 VPS에서 여러 프로젝트가 운영될 수 있다.

```text
Hostinger VPS-01
 ├─ DeployHub
 ├─ LinkVault Worker
 ├─ WorkWiki Scheduler
 ├─ Uptime Kuma
 └─ Reverse Proxy
```

하나의 프로젝트도 여러 자원을 사용할 수 있다.

```text
프로젝트
 ├─ GitHub Repository
 ├─ Vercel Project
 ├─ Supabase Project
 ├─ Docker Container
 └─ Domain
```

---

## 7. 최종 권장 아키텍처

```text
사용자 브라우저
       │
       ▼
Cloudflare DNS 또는 도메인 DNS
       │
       ▼
Caddy 또는 Traefik
  HTTPS / Reverse Proxy
       │
       ▼
┌──────────────────────────────┐
│ Hostinger VPS                │
│                              │
│ Docker Compose               │
│                              │
│ ├─ deployhub-web             │
│ ├─ deployhub-worker          │
│ ├─ deployhub-postgres        │
│ ├─ deployhub-redis           │
│ ├─ uptime-kuma               │
│ ├─ caddy 또는 traefik       │
│ └─ backup-job                │
└──────────────┬───────────────┘
               │
               ▼
외부 Provider API
 ├─ Vercel REST API
 ├─ Supabase Management API
 ├─ Hostinger API
 ├─ GitHub API / Webhook
 └─ Cloudflare API
```

---

## 8. Hostinger VPS 배포 구성

## 8.1 권장 컨테이너

| Container | 역할 | 필수 여부 |
|---|---|---:|
| deployhub-web | 관리 웹과 REST API | 필수 |
| deployhub-worker | 외부 API 동기화, Health Check, 예약작업 | 필수 |
| deployhub-postgres | 관리 데이터베이스 | 필수 |
| caddy 또는 traefik | HTTPS와 Reverse Proxy | 필수 |
| uptime-kuma | URL, API, SSL 모니터링 | 권장 |
| redis | Queue, Cache, Job Lock | 선택 |
| backup-job | PostgreSQL과 설정파일 백업 | 권장 |
| dozzle | Docker Log 간단 조회 | 선택 |

### 8.2 권장 기본안

초기에는 구조를 단순하게 유지한다.

```text
필수
- deployhub-web
- deployhub-worker
- postgres
- caddy
- uptime-kuma

선택
- redis
- dozzle
```

초기 작업량이 적다면 Redis 없이 PostgreSQL Job Table을 사용한다.

---

## 8.3 Docker Compose 예시 구조

```yaml
services:
  web:
    image: ghcr.io/company/deployhub-web:latest
    container_name: deployhub-web
    restart: unless-stopped
    env_file:
      - .env
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - deployhub
    labels:
      deployhub.project: "deployhub"
      deployhub.component: "web"
      deployhub.environment: "production"

  worker:
    image: ghcr.io/company/deployhub-web:latest
    container_name: deployhub-worker
    restart: unless-stopped
    command: ["npm", "run", "worker"]
    env_file:
      - .env
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - deployhub
    labels:
      deployhub.project: "deployhub"
      deployhub.component: "worker"
      deployhub.environment: "production"

  postgres:
    image: postgres:17-alpine
    container_name: deployhub-postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: deployhub
      POSTGRES_USER: deployhub
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U deployhub -d deployhub"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - deployhub

  uptime-kuma:
    image: louislam/uptime-kuma:latest
    container_name: uptime-kuma
    restart: unless-stopped
    volumes:
      - uptime_kuma_data:/app/data
    networks:
      - deployhub

  caddy:
    image: caddy:2-alpine
    container_name: deployhub-caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    networks:
      - deployhub

volumes:
  postgres_data:
  uptime_kuma_data:
  caddy_data:
  caddy_config:

networks:
  deployhub:
```

---

## 8.4 권장 도메인 구조

```text
hub.example.com
  └─ DeployHub 관리화면

status.example.com
  └─ Uptime Kuma 상태화면

api.hub.example.com
  └─ 필요할 경우 외부 Agent·Webhook 전용 API
```

내부 관리 시스템이므로 다음 중 하나를 적용한다.

- Cloudflare Access
- VPN
- Tailscale
- IP Allowlist
- DeployHub 자체 로그인과 2단계 인증

권장 구성은 다음과 같다.

```text
Cloudflare Access
  +
DeployHub 자체 계정 인증
```

---

## 9. 애플리케이션 기술 스택

## 9.1 Frontend 및 API

- Next.js App Router
- TypeScript
- React
- Tailwind CSS
- shadcn/ui
- TanStack Table
- React Flow
- Recharts
- Zod
- React Hook Form

### Next.js 사용 범위

```text
Next.js
 ├─ 관리 UI
 ├─ 인증 화면
 ├─ REST API
 ├─ Webhook Endpoint
 ├─ Server Actions
 └─ 프로젝트 상세 페이지
```

---

## 9.2 데이터베이스

Supabase에 의존하지 않고 VPS 내부 PostgreSQL을 사용한다.

- PostgreSQL 17
- Prisma 또는 Drizzle ORM
- JSONB Metadata
- pg_trgm
- 필요 시 pgvector

### ORM 권장

초기에는 Drizzle ORM을 권장한다.

- 스키마가 명확함
- SQL 구조를 직접 통제하기 쉬움
- PostgreSQL 기능 활용이 편리함
- 마이그레이션 파일 관리가 단순함

Prisma 사용 경험이 더 많다면 Prisma를 사용해도 무방하다.

---

## 9.3 인증

다음 중 하나를 선택한다.

### 권장안

- Auth.js
- PostgreSQL Adapter
- GitHub OAuth
- 관리자 승인 방식

### 대안

- 자체 이메일·비밀번호 로그인
- Keycloak
- Authentik
- Cloudflare Access 전용

소규모 내부 시스템이라면 다음 구성이 가장 단순하다.

```text
Cloudflare Access
  +
Auth.js GitHub Login
```

---

## 9.4 Background Worker

외부 API 동기화와 상태 점검은 웹 요청과 분리된 Worker가 담당한다.

Worker 역할:

- Vercel 프로젝트 동기화
- Supabase 프로젝트 동기화
- Hostinger VPS 동기화
- GitHub Repository 동기화
- URL Health Check
- SSL 만료일 확인
- 미연결 자원 탐지
- 알림 발송
- 통계 Snapshot 저장
- 오래된 데이터 정리

### Job 처리 방식

초기:

```text
PostgreSQL jobs 테이블
  +
Worker Polling
```

확장:

```text
Redis
  +
BullMQ
```

---

## 10. Provider Collector 구조

외부 서비스를 각각 별도 코드로 직접 연결하되 공통 인터페이스를 사용한다.

```typescript
interface ProviderCollector {
  provider: ProviderType;

  testConnection(): Promise<ConnectionResult>;
  listResources(): Promise<ExternalResource[]>;
  getResource(externalId: string): Promise<ExternalResource>;
  sync(): Promise<SyncResult>;
}
```

정규화된 자원 구조는 다음과 같다.

```typescript
interface ExternalResource {
  provider: string;
  externalId: string;
  resourceType: string;
  name: string;
  status: string;
  region?: string;
  url?: string;
  metadata: Record<string, unknown>;
  observedAt: string;
}
```

### 10.1 Collector 목록

```text
collectors/
 ├─ vercel/
 ├─ supabase/
 ├─ hostinger/
 ├─ github/
 ├─ cloudflare/
 ├─ docker/
 └─ uptime-kuma/
```

Provider별 원본 응답은 `metadata`에 저장하되, 공통 필드는 정규화하여 별도 컬럼에 저장한다.

---

## 11. 외부 서비스별 연동

## 11.1 Vercel

수집 대상:

- Team
- Project
- Framework
- Git Repository
- Production Domain
- Deployment
- Deployment Status
- Commit SHA
- Preview URL
- 최근 배포시간
- 환경변수 이름과 Scope

저장하지 않을 정보:

- 환경변수 실제 값
- Secret 원문
- Build Log 전체

---

## 11.2 Supabase

수집 대상:

- Organization
- Project
- Project Ref
- Region
- Database Version
- Project Status
- Auth 사용 여부
- Storage 사용 여부
- Realtime 사용 여부
- Edge Functions
- Branch 정보

DeployHub는 Supabase 데이터를 직접 복제하지 않고 프로젝트 메타데이터와 상태만 관리한다.

---

## 11.3 Hostinger

수집 대상:

- VPS 목록
- VPS 상태
- IP
- Region
- Plan
- CPU
- Memory
- Disk
- Backup 상태
- 서버 작업 상태

Hostinger API로 확인할 수 없는 Docker 내부 상태는 Local Docker Collector가 수집한다.

---

## 11.4 GitHub

수집 대상:

- Repository
- Default Branch
- Languages
- Topics
- 최근 Commit
- Pull Request
- Release
- GitHub Actions
- Workflow Run
- Deployment
- Repository 상태

Webhook 대상:

- Push
- Pull Request Merge
- Release
- Workflow Run
- Deployment
- Deployment Status

---

## 11.5 Cloudflare

선택 연동 대상:

- Zone
- DNS Record
- Proxy 상태
- SSL Mode
- Tunnel
- Access Application
- 도메인 연결 상태

---

## 12. Hostinger VPS와 Docker 자동 수집

DeployHub가 설치된 Hostinger VPS는 별도 원격 Agent 없이 로컬 Docker Socket을 읽을 수 있다.

다만 Docker Socket을 Web Container에 직접 노출하면 보안 위험이 있으므로 별도의 Collector Container를 둔다.

```text
Docker Socket
   │
   ▼
deployhub-docker-collector
   │
   ▼
DeployHub Internal API
   │
   ▼
PostgreSQL
```

### 12.1 Docker Collector 수집 항목

- Container 이름
- Container ID
- Image
- Image Tag
- 실행 상태
- Health Status
- Port
- Network
- Volume
- Label
- 시작 시각
- Restart Count
- Compose Project
- CPU·Memory Snapshot

### 12.2 Docker Socket Proxy 권장

Docker Socket을 직접 Mount하지 않고 `docker-socket-proxy`를 사용할 수 있다.

```text
tecnativa/docker-socket-proxy
```

허용할 API 범위:

- Containers 조회
- Images 조회
- Networks 조회
- Volumes 조회
- Events 조회

차단할 범위:

- Container 생성
- Container 삭제
- Exec
- Image 삭제
- Volume 삭제

---

## 13. Docker Label 표준

VPS에 배포하는 각 프로젝트의 Docker Compose 파일에 DeployHub Label을 추가한다.

```yaml
services:
  app:
    image: company/workwiki:latest
    labels:
      deployhub.project: "workwiki"
      deployhub.component: "web"
      deployhub.environment: "production"
      deployhub.owner: "admin"
      deployhub.url: "https://workwiki.example.com"
      deployhub.repository: "company/workwiki"
```

### 13.1 필수 Label

| Label | 설명 |
|---|---|
| deployhub.project | 프로젝트 Slug |
| deployhub.component | 구성요소명 |
| deployhub.environment | production, staging, development |
| deployhub.url | 운영 URL |
| deployhub.repository | GitHub Repository |

### 13.2 선택 Label

| Label | 설명 |
|---|---|
| deployhub.owner | 담당자 또는 팀 |
| deployhub.description | 구성요소 설명 |
| deployhub.healthcheck | Health Check URL |
| deployhub.version | 배포 버전 |
| deployhub.managed | 자동 관리 여부 |

---

## 14. 프로젝트 등록 방식

## 14.1 관리화면 수동 등록

초기 프로젝트와 외부 자원을 관리자가 직접 등록한다.

등록 항목:

- 프로젝트명
- Slug
- 설명
- 상태
- 중요도
- 담당자
- Repository
- 기술 스택
- Domain
- 구성요소
- 배포 위치
- 문서 링크

---

## 14.2 외부 자원 Import

Provider 연결 후 외부 자원을 가져온다.

```text
Provider 연결
  ↓
외부 자원 동기화
  ↓
미연결 자원 목록
  ↓
기존 프로젝트 연결
또는
신규 프로젝트 생성
또는
관리 제외
```

자동 이름 매칭만으로 즉시 연결하지 않고 사용자가 확인한 후 연결한다.

---

## 14.3 deployhub.yaml

Git Repository에 `deployhub.yaml`을 둔다.

```yaml
apiVersion: deployhub.io/v1
kind: Project

metadata:
  name: LinkVault
  slug: linkvault
  description: 링크 및 개인 지식 관리 시스템

spec:
  lifecycle: production
  owner: admin
  repository: company/linkvault

  components:
    - name: web
      type: frontend
      framework: nextjs
      provider: vercel
      url: https://linkvault.it

    - name: worker
      type: worker
      runtime: nodejs
      provider: hostinger
      container: linkvault-worker

    - name: database
      type: database
      provider: supabase
      externalRef: abcdefghijklmnop

  domains:
    - linkvault.it
    - api.linkvault.it
```

Backstage의 `catalog-info.yaml` 개념을 단순화하여 적용한다.

---

## 14.4 배포 Webhook

GitHub Actions 또는 배포 스크립트가 DeployHub로 배포 정보를 보낸다.

```json
{
  "projectSlug": "workwiki",
  "component": "web",
  "environment": "production",
  "version": "2026.07.26.1",
  "commitSha": "a41d82c",
  "status": "success",
  "image": "ghcr.io/company/workwiki:a41d82c"
}
```

---

## 15. 데이터베이스 설계

## 15.1 주요 테이블

```text
users
teams
projects
project_owners
components
repositories
providers
provider_accounts
resources
component_resources
deployments
domains
health_checks
monitoring_snapshots
integration_events
documents
alerts
audit_logs
jobs
```

---

## 15.2 projects

```text
id
name
slug
description
status
lifecycle
importance
owner_team_id
created_at
updated_at
archived_at
```

### status

```text
active
paused
maintenance
archived
```

### lifecycle

```text
experimental
development
production
deprecated
```

---

## 15.3 components

```text
id
project_id
name
slug
component_type
framework
runtime
language
description
criticality
created_at
updated_at
```

### component_type

```text
frontend
backend
api
worker
scheduler
database
authentication
storage
cache
queue
monitoring
```

---

## 15.4 resources

```text
id
provider_account_id
external_resource_id
resource_type
name
status
region
url
metadata_json
first_seen_at
last_seen_at
last_synced_at
deleted_at
```

### resource_type

```text
vercel_project
vercel_deployment
supabase_project
hostinger_vps
docker_container
docker_image
github_repository
cloudflare_zone
domain
database
storage_bucket
external_api
```

---

## 15.5 component_resources

```text
id
component_id
resource_id
environment
relation_type
is_primary
created_at
```

### relation_type

```text
runs_on
deployed_to
uses
depends_on
exposed_by
monitored_by
```

---

## 15.6 deployments

```text
id
project_id
component_id
provider
environment
version
commit_sha
image_name
external_deployment_id
status
deployment_url
started_at
completed_at
triggered_by
metadata_json
```

---

## 15.7 domains

```text
id
project_id
component_id
domain
environment
dns_provider
target
ssl_issuer
ssl_expires_at
status
last_checked_at
```

---

## 15.8 health_checks

```text
id
project_id
component_id
resource_id
check_type
target
expected_status
current_status
response_time_ms
checked_at
failure_count
error_message
```

---

## 15.9 audit_logs

```text
id
user_id
action
entity_type
entity_id
before_json
after_json
ip_address
created_at
```

---

## 16. 화면 구성

## 16.1 좌측 Navigation

```text
Overview
Projects
Infrastructure
Deployments
Monitors
Providers
Domains
Alerts
Documents
Settings
```

하단 Utility:

```text
Search
Command Palette
User Profile
System Status
```

---

## 16.2 통합 대시보드

상단 Summary Card:

- 전체 프로젝트
- 운영 프로젝트
- 장애
- 주의
- 최근 24시간 배포
- 미연결 자원
- SSL 만료 예정
- VPS 사용률

중앙 영역:

- 프로젝트 상태 목록
- 최근 배포
- 장애 및 경고
- VPS 자원 사용률
- Provider 연결 상태
- 최근 변경사항

### 예시

```text
Projects          18
Healthy           14
Warning            3
Critical           1
Deployments        7
Unlinked Resources 5
```

---

## 16.3 프로젝트 목록

| 프로젝트 | 구성 | 배포 | DB | 상태 | 최근 배포 |
|---|---|---|---|---|---|
| LinkVault | Next.js + Worker | Vercel + VPS | Supabase | 정상 | 12분 전 |
| WorkWiki | Next.js | VPS Docker | PostgreSQL | 정상 | 2시간 전 |
| ETFlow | Next.js + Python | VPS Docker | PostgreSQL | 주의 | 3일 전 |
| DeployHub | Next.js + Worker | VPS Docker | PostgreSQL | 정상 | 5분 전 |

검색과 Filter:

- 상태
- Lifecycle
- Provider
- Framework
- 담당자
- Production 여부
- 미연결 자원 여부

---

## 16.4 프로젝트 상세

### Overview

- 프로젝트명
- 설명
- Lifecycle
- 중요도
- 담당자
- Repository
- 운영 URL
- 최근 배포
- 전체 상태

### Architecture

React Flow로 시각화한다.

```text
GitHub
  ↓
VPS Docker
  ├─ Web
  ├─ Worker
  └─ PostgreSQL
       ↓
Caddy
       ↓
Domain
```

### Components

각 구성요소의 기술, Provider, 상태와 URL을 표시한다.

### Resources

연결된 VPS, Container, Vercel, Supabase, Domain을 표시한다.

### Deployments

Commit, Image, Version, 배포 상태와 시간을 표시한다.

### Monitoring

응답시간, 가동률, SSL 만료와 장애 이력을 표시한다.

### Documents

- README
- PRD
- 운영 매뉴얼
- 장애 대응서
- 환경변수 설명서
- 백업·복구 절차

---

## 16.5 Infrastructure

### VPS 목록

| VPS | Region | CPU | Memory | Disk | Containers | 상태 |
|---|---|---:|---:|---:|---:|---|
| hostinger-prod-01 | Singapore | 18% | 62% | 48% | 12 | 정상 |

### VPS 상세

- 서버 사양
- IP
- OS
- Docker Version
- CPU
- Memory
- Disk
- Container
- Network
- Volume
- Backup
- 연결 프로젝트
- 최근 이벤트

---

## 16.6 Docker Container 목록

| Container | 프로젝트 | 구성요소 | Image | 상태 | CPU | Memory |
|---|---|---|---|---|---:|---:|
| deployhub-web | DeployHub | Web | deployhub:a41d | Running | 1.8% | 220MB |
| workwiki-web | WorkWiki | Web | workwiki:91ac | Running | 1.2% | 180MB |
| linkvault-worker | LinkVault | Worker | worker:4b81 | Restarting | 8.4% | 340MB |

Label이 없는 Container는 `Unlinked`로 표시한다.

---

## 16.7 Command Palette

Raycast 디자인을 기능적으로 활용한다.

단축키:

```text
Ctrl + K
또는
⌘ + K
```

지원 명령:

- 프로젝트 검색
- 프로젝트 열기
- 새 프로젝트 등록
- Provider 동기화
- VPS 열기
- Container 검색
- 최근 배포 보기
- 장애 목록 보기
- 미연결 자원 보기
- 문서 검색

Command Palette는 단순 장식이 아니라 주요 탐색 수단으로 사용한다.

---

## 17. 디자인 시스템

첨부된 `DESIGN-raycast.md`를 기준으로 전체 UI를 구성한다.

## 17.1 디자인 원칙

- Dark Mode 단독 사용
- 개발자 도구와 Command Palette 중심 분위기
- 그림자 대신 Surface 단계로 깊이 표현
- 1px Hairline Border 사용
- 카드 Radius는 6~10px 중심
- Primary Action은 흰색 버튼
- Accent Color는 상태와 아이콘에 제한
- 화면당 강한 Primary CTA는 하나 이하
- 데이터 밀도는 높되 여백과 계층을 명확하게 유지

---

## 17.2 색상

```css
:root {
  --canvas: #07080a;
  --surface: #0d0d0d;
  --surface-elevated: #101111;
  --surface-card: #121212;

  --ink: #f4f4f6;
  --body: #cdcdcd;
  --mute: #9c9c9d;
  --ash: #6a6b6c;

  --hairline: #242728;
  --hairline-soft: rgba(255, 255, 255, 0.08);
  --hairline-strong: rgba(255, 255, 255, 0.16);

  --primary: #ffffff;
  --on-primary: #000000;

  --success: #59d499;
  --warning: #ffc533;
  --error: #ff6161;
  --info: #57c1ff;
}
```

### 상태 색상 사용

| 상태 | 색상 |
|---|---|
| 정상 | Green |
| 주의 | Yellow |
| 장애 | Red |
| 정보 | Blue |
| 미확인 | Gray |

Accent Color는 버튼 전체 배경으로 사용하지 않고 Badge, Dot, Icon과 작은 상태 표시에만 사용한다.

---

## 17.3 Typography

기본 Font:

```css
font-family: Inter, "Noto Sans KR", system-ui, sans-serif;
font-feature-settings: "calt", "kern", "liga", "ss03";
```

한국어 표시를 위해 `Noto Sans KR`을 Fallback으로 둔다.

| 용도 | 크기 | 굵기 |
|---|---:|---:|
| 페이지 제목 | 28~32px | 600 |
| Section 제목 | 20~24px | 500 |
| Card 제목 | 16~18px | 500 |
| 본문 | 14~16px | 400 |
| Table Header | 13~14px | 500 |
| Metadata | 12~13px | 400 |

Marketing Page처럼 56~64px의 Hero 제목을 관리 화면에 반복 사용하지 않는다.

---

## 17.4 Surface

```text
Canvas
  #07080a

Sidebar / Card
  #0d0d0d

Input / Active Tab
  #101111

Selected Row / Nested Card
  #121212
```

그림자는 사용하지 않는다.

```css
border: 1px solid #242728;
box-shadow: none;
```

---

## 17.5 Radius

```text
Badge       4px
Row         6px
Button      8px
Input       8px
Card       10px
Modal      16px
Pill        9999px
```

---

## 17.6 주요 Component

### Primary Button

- 흰색 배경
- 검은색 글자
- 높이 36px
- Radius 8px
- 한 화면에 과도하게 반복하지 않음

### Secondary Button

- 투명 또는 Surface 배경
- 흰색 글자
- Hairline Border

### Input

- `#101111`
- Height 36~40px
- 1px Border
- Focus 시 Accent Ring 대신 Border 밝기 증가

### Card

- `#0d0d0d`
- 1px `#242728`
- Radius 10px
- Padding 16~24px

### Table Row

- 기본 투명
- Hover 및 선택 시 `#121212`
- 상태는 작은 Dot와 Badge 사용

### Keycap

단축키 표시에 사용한다.

```text
⌘ K
Ctrl K
Esc
Enter
```

---

## 17.7 레이아웃

Desktop:

```text
┌────────────┬───────────────────────────────────────┐
│ Sidebar    │ Topbar                               │
│ 240px      ├───────────────────────────────────────┤
│            │ Main Content                          │
│            │                                       │
└────────────┴───────────────────────────────────────┘
```

권장 규격:

- Sidebar: 220~240px
- Main Max Width: 제한하지 않고 Dashboard 폭 활용
- Page Padding: 24~32px
- Card Gap: 16px
- Section Gap: 24~32px
- Dashboard Grid: 12 Column

첨부 디자인의 96px Section 간격은 Marketing Page 기준이므로 관리 시스템에서는 24~32px로 축소한다.

---

## 17.8 반응형

### Desktop

- Sidebar 고정
- Dashboard 4~6개 Summary Card
- Table 중심

### Tablet

- Sidebar 접힘
- 2열 Summary Card
- Table 가로 스크롤

### Mobile

- Bottom Navigation 또는 Drawer
- Summary Card 1열
- Table 대신 List Card
- Command Palette 전체화면

DeployHub는 내부 운영 도구이므로 Desktop 경험을 우선한다.

---

## 18. 모니터링 설계

## 18.1 Uptime Kuma 담당

- HTTP/HTTPS
- TCP
- Ping
- DNS
- SSL 인증서
- Push Monitor
- 외부 알림

DeployHub는 Uptime Kuma Monitor ID를 프로젝트와 연결하여 상태를 가져온다.

---

## 18.2 DeployHub 자체 담당

- Provider API 연결 상태
- 최근 동기화 시각
- Docker Container 상태
- VPS 자원 사용률
- GitHub Workflow
- Vercel Deployment
- Supabase Project 상태
- 배포 이력
- 미연결 자원

---

## 18.3 Health Check 기준

### 정상

- 핵심 URL 응답
- 핵심 Container Running
- Database 연결 정상
- 최근 배포 성공
- 동기화 정상

### 주의

- 응답시간 증가
- CPU·Memory 기준 초과
- SSL 만료 30일 이내
- 최근 동기화 지연
- 비핵심 Container 오류

### 장애

- 운영 URL 응답 없음
- 핵심 Container 중지
- Database 연결 실패
- 최근 배포 실패 후 미복구
- VPS 연결 실패

### 미확인

- Agent 또는 Collector 통신 중단
- Provider Token 오류
- 최근 상태 데이터 없음

---

## 19. 알림

알림 대상:

- 운영 URL 장애
- Docker Container 중지 또는 반복 재시작
- VPS Disk 85% 이상
- Memory 90% 이상
- 최근 배포 실패
- GitHub Actions 실패
- SSL 만료 30일 이내
- Provider 연결 실패
- Backup 실패

알림 채널 우선순위:

1. Telegram
2. 이메일
3. DeployHub 내부 알림
4. Slack 선택 지원

---

## 20. 백업 및 복구

## 20.1 백업 대상

- PostgreSQL
- `.env` 암호화본
- Caddy 또는 Traefik 설정
- Docker Compose 파일
- Uptime Kuma 데이터
- DeployHub 업로드 문서
- Provider 설정 메타데이터

## 20.2 권장 주기

| 대상 | 주기 |
|---|---|
| PostgreSQL Dump | 매일 |
| Compose 및 설정 | 변경 시 |
| Uptime Kuma | 매일 |
| 전체 Volume Snapshot | 주 1회 |
| 외부 저장소 복제 | 매일 |

백업은 동일 VPS 내부에만 보관하지 않는다.

권장 외부 저장소:

- Cloudflare R2
- Backblaze B2
- S3 Compatible Storage
- 별도 NAS

---

## 21. 보안

## 21.1 Provider Token

- DB 평문 저장 금지
- AES-GCM 등으로 암호화
- 암호화 Key는 환경변수로 분리
- 가능한 경우 Read-only Token
- Token 마지막 검증일 관리
- Token 재발급 이력 관리

## 21.2 Docker 보안

- Web Container에 Docker Socket 직접 연결 금지
- Read-only Docker Socket Proxy 사용
- Container 조작 API 차단
- Rootless Container 검토
- 불필요한 Port 외부 노출 금지

## 21.3 네트워크

외부 공개 Port:

```text
80
443
```

내부 전용:

```text
PostgreSQL 5432
Redis 6379
Uptime Kuma 내부 Port
Docker Socket Proxy
```

PostgreSQL과 Redis는 Host Port로 공개하지 않는다.

---

## 22. 프로젝트 디렉터리 구조

```text
deployhub/
 ├─ apps/
 │   ├─ web/
 │   └─ worker/
 ├─ packages/
 │   ├─ database/
 │   ├─ ui/
 │   ├─ collectors/
 │   ├─ monitoring/
 │   ├─ auth/
 │   └─ shared/
 ├─ docker/
 │   ├─ Caddyfile
 │   ├─ docker-compose.yml
 │   └─ backup/
 ├─ drizzle/
 ├─ docs/
 │   ├─ architecture.md
 │   ├─ deployment.md
 │   ├─ providers.md
 │   └─ recovery.md
 ├─ deployhub.yaml
 ├─ Dockerfile
 ├─ .env.example
 └─ README.md
```

Turborepo 사용 여부는 선택사항이다.

프로젝트가 커질 가능성이 높다면 다음 구조를 권장한다.

```text
pnpm workspace
  +
Turborepo
```

---

## 23. API 설계

### 프로젝트

```text
GET    /api/projects
POST   /api/projects
GET    /api/projects/:id
PATCH  /api/projects/:id
DELETE /api/projects/:id
```

### 구성요소

```text
GET    /api/projects/:id/components
POST   /api/projects/:id/components
PATCH  /api/components/:id
```

### Provider

```text
GET    /api/providers
POST   /api/providers/:provider/connect
POST   /api/providers/:provider/test
POST   /api/providers/:provider/sync
```

### 자원

```text
GET    /api/resources
GET    /api/resources/unlinked
POST   /api/resources/:id/link
POST   /api/resources/:id/ignore
```

### 배포

```text
GET    /api/deployments
POST   /api/deployments
POST   /api/webhooks/deployment
```

### 모니터링

```text
GET    /api/health
GET    /api/monitors
POST   /api/monitors
POST   /api/internal/docker/snapshot
```

---

## 24. 개발 단계

## 24.1 1단계: 프로젝트 카탈로그 MVP

구현 기능:

- 로그인
- 프로젝트 등록·수정
- 구성요소 등록
- 기술 스택 관리
- Repository와 Domain 등록
- 프로젝트 목록
- 프로젝트 상세
- 문서 링크
- Dark UI
- Command Palette 기본 검색

완료 기준:

```text
모든 프로젝트의 기술 구성과 배포 위치를
한 화면에서 확인할 수 있다.
```

---

## 24.2 2단계: Docker 및 VPS 통합

구현 기능:

- Hostinger VPS 등록
- Docker Collector
- Docker Label 자동 매칭
- Container 목록
- VPS CPU·Memory·Disk
- Unlinked Container
- 프로젝트별 Container 연결

완료 기준:

```text
VPS에서 어떤 Container가 실행 중이며
각 Container가 어느 프로젝트에 속하는지 확인할 수 있다.
```

---

## 24.3 3단계: 외부 Provider 연동

구현 순서:

1. GitHub
2. Vercel
3. Supabase
4. Hostinger
5. Cloudflare

구현 기능:

- Provider Account
- Token 연결
- Connection Test
- 자원 동기화
- 미연결 자원
- 프로젝트 연결
- Sync Log

---

## 24.4 4단계: 배포 이력

- GitHub Webhook
- GitHub Actions 연동
- 배포 API
- Commit SHA
- Docker Image Tag
- 배포 성공·실패
- 최근 배포
- 배포 후 Health Check

---

## 24.5 5단계: 모니터링과 알림

- Uptime Kuma 연결
- SSL 만료
- Docker Health
- Provider 상태
- Telegram 알림
- Alert 이력
- 장애 상태 자동 판정

---

## 24.6 6단계: 운영 고도화

- 비용 메타데이터
- Backup 상태
- API Key 갱신일
- 프로젝트 폐기 Workflow
- 영향도 분석
- 서비스 Dependency Graph
- 운영 Score
- 보안 Checklist
- 월간 운영 Report

---

## 25. MVP 우선순위

### Must Have

- 프로젝트 관리
- 구성요소 관리
- 기술 스택 표시
- Docker Container 자동 수집
- VPS 상태
- GitHub Repository
- Domain
- 최근 배포
- URL Health Check
- 미연결 자원
- Raycast 계열 Dark UI

### Should Have

- Vercel 연동
- Supabase 연동
- Hostinger API
- Uptime Kuma
- Telegram 알림
- Command Palette
- Architecture Graph

### Could Have

- Cloudflare 연동
- 비용관리
- Backup 상태
- 월간 Report
- 자동 프로젝트 생성
- Docker Image 취약점 결과 연결

### Won't Have in MVP

- 원격 서버 제어
- 환경변수 편집
- DNS 직접 수정
- 자동 롤백
- 전체 로그 검색
- Kubernetes 지원

---

## 26. 권장 개발 순서

```text
1. Docker Compose 기반 기본 인프라
2. PostgreSQL Schema
3. 인증
4. 프로젝트·구성요소 CRUD
5. Raycast 계열 Dashboard UI
6. Docker Collector
7. GitHub 연동
8. Vercel·Supabase 연동
9. Uptime Kuma 연동
10. 배포 Webhook
11. 알림
12. 백업과 운영 문서
```

---

## 27. 최종 배포 형태

```text
Hostinger VPS
 ├─ Caddy
 │   ├─ hub.example.com
 │   └─ status.example.com
 │
 ├─ DeployHub Web
 ├─ DeployHub Worker
 ├─ PostgreSQL
 ├─ Docker Collector
 ├─ Uptime Kuma
 └─ Backup Job
```

### 관리 대상

```text
DeployHub
 ├─ Hostinger VPS
 ├─ Docker Container
 ├─ GitHub
 ├─ Vercel
 ├─ Supabase
 ├─ Cloudflare
 ├─ Domain
 └─ External API
```

---

## 28. 최종 권고안

DeployHub는 Backstage처럼 대규모 Internal Developer Portal을 그대로 도입하기보다, 필요한 기능만 골라 만든 경량 시스템으로 개발한다.

핵심 방향은 다음과 같다.

1. **Hostinger VPS 단독 자가 호스팅**
2. **Docker Compose 기반 배포**
3. **PostgreSQL 자체 운영**
4. **프로젝트와 인프라의 다대다 관계**
5. **Docker Label 기반 자동 매칭**
6. **Provider Collector 방식의 외부 서비스 연동**
7. **Uptime Kuma를 활용한 상태 모니터링**
8. **Raycast 계열 Dark Developer Tool 디자인**
9. **초기에는 조회와 상태 확인 중심**
10. **운영 제어 기능은 안정화 후 추가**

첫 번째 완성 목표는 다음과 같다.

```text
프로젝트명
기술 스택
배포 위치
연결 서버와 Container
Database와 외부 서비스
운영 Domain
최근 배포
현재 상태
```

이 정보를 한 화면에서 즉시 확인할 수 있다면 DeployHub의 핵심 목적은 달성된 것으로 본다.


---

## 29. AI 기반 프로젝트 등록 운영방식

DeployHub의 핵심 사용방식은 사용자가 프로젝트 개발 중 또는 개발 완료 후 바이브코딩 AI에게 다음과 같이 명령하는 것이다.

```text
현재 프로젝트를 분석해서 DeployHub에 등록해줘.
```

AI는 DeployHub의 YAML 구조를 임의로 추측하지 않고, DeployHub CLI를 이용해 최신 Manifest Schema와 Template을 받아 프로젝트를 분석한 후 등록한다.

### 29.1 전체 등록 흐름

```text
사용자
  ↓
바이브코딩 AI에게 등록 명령
  ↓
AI가 DeployHub CLI 실행
  ↓
DeployHub 서버에서 최신 Schema·Template 조회
  ↓
프로젝트 파일 자동 분석
  ↓
deployhub.yaml 생성 또는 수정
  ↓
Schema 검증
  ↓
기존 등록정보와 Diff
  ↓
사용자 인증 또는 승인
  ↓
Draft 등록
  ↓
DeployHub 관리화면에서 최종 검토
  ↓
Active 전환
```

### 29.2 기본 원칙

1. AI가 YAML 구조를 직접 외우거나 임의로 생성하지 않는다.
2. DeployHub 서버가 최신 Manifest Schema를 제공한다.
3. DeployHub CLI가 프로젝트 구조를 분석하여 초안을 만든다.
4. AI가 설명, 담당자, 프로젝트 목적 등 자동 탐지가 어려운 내용을 보완한다.
5. AI가 등록한 정보는 기본적으로 Draft 상태로 저장한다.
6. 삭제, 서버 제어, Token 조회 권한은 AI에게 제공하지 않는다.
7. 장기 API Key를 프롬프트나 프로젝트 파일에 기록하지 않는다.

---

## 30. 선언 정보와 관측 정보 분리

DeployHub에서는 프로젝트 정보의 출처를 두 가지로 분리한다.

### 30.1 선언 정보

Git Repository의 `deployhub.yaml`에 저장한다.

예시:

- 프로젝트명
- 프로젝트 설명
- 담당자
- Lifecycle
- 구성요소 역할
- 기술 스택
- 의존 관계
- 운영 환경
- 문서 위치
- 중요도

### 30.2 관측 정보

DeployHub Collector가 자동으로 수집한다.

예시:

- 현재 실행 중인 Docker Container
- Docker Image Tag
- 최근 Commit
- 최근 배포
- Container Health
- CPU·Memory·Disk
- URL 응답상태
- SSL 만료일
- Provider 연결 상태

### 30.3 기준 관계

```text
deployhub.yaml
  = 사용자가 선언한 프로젝트 구성

DeployHub Database
  = 선언 정보 + 외부 Provider 관측 정보 + 운영 이력
```

DeployHub는 선언 정보와 실제 관측 정보가 다를 경우 이를 Drift로 표시한다.

예시:

```text
Declared
- Worker Image: workwiki-worker:v1.4

Observed
- Running Image: workwiki-worker:v1.3

Result
- Configuration Drift
```

---

## 31. DeployHub Manifest 설계

## 31.1 파일 위치

프로젝트 Root에 다음 파일을 둔다.

```text
project-root/
 ├─ src/
 ├─ package.json
 ├─ Dockerfile
 ├─ compose.yaml
 ├─ deployhub.yaml
 └─ README.md
```

## 31.2 기본 Manifest 예시

```yaml
# yaml-language-server: $schema=https://hub.example.com/schemas/deployhub-v1.json

apiVersion: deployhub.io/v1
kind: Project

metadata:
  name: WorkWiki
  slug: workwiki
  description: 사내 SOP 및 업무지식 관리 시스템

spec:
  lifecycle: production
  owner: admin

  repository:
    provider: github
    slug: ktgo/workwiki

  components:
    - name: web
      type: frontend
      framework: nextjs
      runtime: nodejs
      language: typescript
      path: .

    - name: api
      type: api
      framework: nextjs-route-handler
      runtime: nodejs
      path: app/api

    - name: database
      type: database
      provider: postgresql

  deployments:
    - environment: production
      provider: hostinger
      method: docker-compose
      serverRef: hostinger-prod-01

  domains:
    - domain: workwiki.example.com
      environment: production

  documents:
    - type: readme
      path: README.md
```

## 31.3 Manifest 버전

```text
deployhub.io/v1
deployhub.io/v1beta1
deployhub.io/v2
```

Manifest 버전이 변경되더라도 기존 프로젝트가 즉시 실패하지 않도록 한다.

CLI는 다음 기능을 제공한다.

```bash
deployhub manifest upgrade
```

---

## 32. Manifest Schema 제공

AI가 YAML 구조를 미리 알 필요가 없도록 DeployHub 서버가 최신 스키마와 템플릿을 제공한다.

### 32.1 API

```text
GET /api/v1/manifest/schema
GET /api/v1/manifest/template
GET /api/v1/manifest/examples
GET /api/v1/manifest/versions
POST /api/v1/manifest/validate
```

### 32.2 정적 Schema URL

```text
https://hub.example.com/schemas/deployhub-v1.json
```

### 32.3 JSON Schema 역할

- 필수 필드 정의
- Enum 정의
- 데이터 타입 검증
- 설명과 예시 제공
- IDE 자동완성
- AI 입력 구조 제한
- API 입력 검증
- Version 호환성 확인

### 32.4 Schema Header

```yaml
# yaml-language-server: $schema=https://hub.example.com/schemas/deployhub-v1.json
```

이를 통해 VS Code 및 YAML Language Server에서 자동완성과 오류 표시를 사용할 수 있다.

---

## 33. DeployHub CLI

DeployHub CLI는 AI와 DeployHub 사이의 표준 인터페이스다.

AI가 REST API를 직접 조합하지 않고 CLI 명령을 실행하도록 한다.

### 33.1 설치 방식

전역 설치:

```bash
npm install -g @deployhub/cli
```

일회성 실행:

```bash
npx @deployhub/cli
```

프로젝트 Dev Dependency:

```bash
pnpm add -D @deployhub/cli
```

### 33.2 주요 명령

```text
deployhub login
deployhub logout
deployhub init
deployhub inspect
deployhub validate
deployhub diff
deployhub register
deployhub sync
deployhub pull
deployhub status
deployhub manifest upgrade
```

### 33.3 명령별 역할

| 명령 | 역할 |
|---|---|
| `login` | 사용자 인증 및 단기 Token 발급 |
| `logout` | 로컬 인증정보 폐기 |
| `init` | 최소 Manifest 생성 |
| `init --detect` | 프로젝트 분석 후 Manifest 자동 생성 |
| `inspect` | 기술 스택 및 배포구조 분석 |
| `validate` | 최신 Schema 기반 검증 |
| `diff` | 로컬 선언과 DeployHub 등록정보 비교 |
| `register --draft` | 신규 Draft 등록 |
| `sync --draft` | 기존 프로젝트 변경안 제출 |
| `pull` | DeployHub 선언정보 조회 |
| `status` | 등록·연결·동기화 상태 확인 |
| `manifest upgrade` | Manifest 버전 변환 |

---

## 34. 프로젝트 자동 탐지

`deployhub init --detect`는 다음 파일을 분석한다.

```text
package.json
pnpm-lock.yaml
yarn.lock
package-lock.json
requirements.txt
pyproject.toml
go.mod
Cargo.toml
Dockerfile
compose.yaml
docker-compose.yml
.env.example
next.config.*
vite.config.*
nuxt.config.*
prisma/schema.prisma
drizzle.config.*
supabase/config.toml
.github/workflows/*
README.md
```

### 34.1 탐지 대상

- 프로젝트명
- Package Manager
- Programming Language
- Frontend Framework
- Backend Framework
- Runtime
- Database
- ORM
- Cache
- Queue
- Docker 배포 여부
- Compose Service
- Port
- Git Repository
- CI/CD Workflow
- Domain 단서
- Environment 이름

### 34.2 탐지 결과 출처

```yaml
framework: nextjs

detection:
  source: package.json
  evidence: next@16.1.0
  confidence: high
```

### 34.3 신뢰도 구분

```text
declared
detected
inferred
unknown
```

| 상태 | 의미 |
|---|---|
| `declared` | 사용자가 직접 지정 |
| `detected` | 파일과 설정에서 확인 |
| `inferred` | AI 또는 CLI가 정황상 추론 |
| `unknown` | 확인 불가 |

`inferred`와 `unknown` 항목은 Draft 검토화면에서 강조한다.

---

## 35. AI 작업 지침 제공

## 35.1 AGENTS.md

프로젝트 Template 또는 조직 공통 Repository에 다음 지침을 포함한다.

```markdown
# DeployHub Registration

이 프로젝트의 기술 구성이나 배포 환경이 변경되면 DeployHub 정보를 갱신한다.

신규 프로젝트:
1. `deployhub init --detect`
2. `deployhub validate`
3. 추론 항목과 경고 확인
4. `deployhub register --draft`

기존 프로젝트:
1. `deployhub inspect`
2. `deployhub diff`
3. 필요한 경우 `deployhub.yaml` 수정
4. `deployhub sync --draft`

YAML 구조를 임의로 추측하지 말고 반드시 DeployHub CLI가 제공하는
최신 Schema와 Template을 사용한다.

장기 Token, 사용자 비밀번호, Provider Secret을 파일이나 대화에 기록하지 않는다.
```

### 35.2 사용자 명령 예시

```text
현재 프로젝트를 DeployHub에 등록해줘.

YAML 구조를 직접 추측하지 말고 DeployHub CLI를 사용해.
deployhub init --detect로 최신 Schema와 Template을 받아
deployhub.yaml을 생성하고 검증한 후 Draft로 등록해.

추론한 항목과 확실하지 않은 항목은 등록 전에 보여줘.
```

---

## 36. 신규 프로젝트 등록 절차

```text
1. AI가 프로젝트 Root 확인
2. deployhub.yaml 존재 여부 확인
3. 없으면 deployhub init --detect 실행
4. 최신 Schema와 Template 다운로드
5. 프로젝트 파일 분석
6. deployhub.yaml 생성
7. AI가 설명·담당자·목적 보완
8. deployhub validate 실행
9. 경고와 추론항목 출력
10. 사용자 인증
11. deployhub register --draft 실행
12. DeployHub가 외부 자원과 교차 검증
13. 사용자가 관리화면에서 최종 승인
14. 프로젝트를 Active로 전환
```

---

## 37. 기존 프로젝트 갱신 절차

```text
1. AI가 기존 deployhub.yaml 확인
2. deployhub inspect 실행
3. DeployHub 기존 등록정보 조회
4. 현재 코드와 설정 비교
5. deployhub diff 출력
6. Manifest 수정
7. deployhub validate
8. deployhub sync --draft
9. 변경사항 승인
```

### 37.1 등록정보 우선순위

충돌 시 다음 우선순위를 적용한다.

```text
사용자 확정값
  >
deployhub.yaml declared
  >
설정파일 detected
  >
AI inferred
  >
Provider observed metadata
```

단, 실행 상태와 배포 상태는 관측값을 우선한다.

---

## 38. 인증 방식

## 38.1 금지 방식

다음 방식은 사용하지 않는다.

- AI에게 사용자 아이디·비밀번호 제공
- 장기 API Key를 대화에 직접 입력
- Token을 URL Query String에 포함
- Token을 `deployhub.yaml`에 저장
- Token을 README 또는 Dockerfile에 저장
- 전체 관리자 권한 Token 사용

---

## 38.2 MVP 인증: 일회용 등록 Token

초기 버전에서는 DeployHub 관리화면에서 등록용 Token을 발급한다.

Token 조건:

```text
용도: 프로젝트 Draft 등록
유효시간: 10분
사용횟수: 1회
Scope: project:draft:create
Repository: 선택 제한
Project Slug: 선택 제한
```

Token 예시:

```text
dh_reg_7Gk92x...
```

Token은 프롬프트에 직접 입력하지 않고 환경변수로 제공한다.

Linux/macOS:

```bash
export DEPLOYHUB_URL=https://hub.example.com
export DEPLOYHUB_TOKEN=dh_reg_xxxxx
```

Windows PowerShell:

```powershell
$env:DEPLOYHUB_URL = "https://hub.example.com"
$env:DEPLOYHUB_TOKEN = "dh_reg_xxxxx"
```

CLI 사용:

```bash
deployhub register --draft --token-env DEPLOYHUB_TOKEN
```

DB에는 Token 원문이 아닌 Hash만 저장한다.

---

## 38.3 정식 인증: Device Login

정식 버전에서는 브라우저 승인형 Device Login을 사용한다.

AI가 실행:

```bash
deployhub login
```

CLI 출력:

```text
브라우저에서 다음 주소를 여십시오.

https://hub.example.com/device

인증 코드:
KTGO-7H3K
```

사용자가 브라우저에서 확인할 내용:

```text
요청 프로그램: DeployHub CLI
작업: Project Draft 생성·수정
Repository: ktgo/workwiki
작업 디렉터리: C:\projects\workwiki
유효시간: 30분
```

승인 후 CLI가 단기 Access Token을 받는다.

### Token 기본값

```text
Access Token: 30분
Refresh Token: 선택 사용
Scope: 최소 권한
Device Session: 단일 기기
```

---

## 38.4 AI 권한 Scope

AI 또는 CLI 기본 Scope:

```text
project:read
project:draft:create
project:draft:update
manifest:validate
resource:read
deployment:read
```

허용하지 않는 Scope:

```text
project:delete
provider:manage
credential:read
server:control
container:restart
container:delete
domain:update
user:manage
```

---

## 39. Draft 승인 Workflow

AI가 등록한 정보는 직접 Active가 되지 않는다.

```text
AI Submit
  ↓
Draft
  ↓
Automatic Validation
  ↓
Pending Review
  ↓
User Approval
  ↓
Active
```

상태:

```text
draft
validation_failed
pending_review
approved
rejected
superseded
```

### 39.1 검토화면

- 신규 항목
- 변경 항목
- 삭제 예정 항목
- 자동 탐지 항목
- AI 추론 항목
- Provider 관측값과 충돌
- 보안 경고
- 미확인 필수값

---

## 40. GitHub Actions 인증

배포 완료 후 DeployHub 배포 이력을 갱신하는 경우 GitHub Actions OIDC 사용을 권장한다.

```text
GitHub Actions
  ↓
GitHub OIDC Token
  ↓
DeployHub Token Exchange
  ↓
Repository·Branch·Audience 검증
  ↓
단기 Deploy Token
  ↓
Deployment 등록
```

### 40.1 검증 Claim

```text
issuer
audience
repository
repository_owner
ref
workflow
environment
```

### 40.2 Workflow 예시

```yaml
permissions:
  contents: read
  id-token: write

steps:
  - uses: actions/checkout@v4

  - name: Publish deployment
    run: |
      npx @deployhub/cli deployment publish \
        --project workwiki \
        --environment production \
        --commit "$GITHUB_SHA"
```

장기 DeployHub Secret은 원칙적으로 저장하지 않는다.

---

## 41. MCP 확장계획

CLI 안정화 후 DeployHub MCP Server를 추가한다.

### 41.1 제공 Tool

```text
deployhub.get_manifest_schema
deployhub.get_manifest_template
deployhub.inspect_project
deployhub.generate_manifest
deployhub.validate_manifest
deployhub.diff_project
deployhub.create_project_draft
deployhub.update_project_draft
deployhub.get_registration_status
```

### 41.2 사용 흐름

```text
AI Client
  ↓
DeployHub MCP
  ↓
Schema 기반 Tool 호출
  ↓
사용자 OAuth 승인
  ↓
Draft 생성
```

### 41.3 MCP 원칙

- Tool별 최소 Scope
- Token은 Authorization Header 사용
- Token을 URL에 포함하지 않음
- 로컬 STDIO 방식은 환경변수 사용
- Tool 호출 전체 Audit Log 저장
- Project Draft 외 직접 운영제어 금지

---

## 42. 인증 관련 데이터베이스

추가 테이블:

```text
device_authorizations
access_tokens
refresh_tokens
registration_tokens
oauth_clients
oidc_trust_policies
project_drafts
draft_changes
manifest_versions
manifest_schemas
cli_sessions
mcp_sessions
```

### 42.1 registration_tokens

```text
id
token_hash
scope
repository_constraint
project_slug_constraint
expires_at
max_uses
used_count
created_by
created_at
revoked_at
```

### 42.2 device_authorizations

```text
id
device_code_hash
user_code
client_name
requested_scopes
repository
working_directory
status
expires_at
approved_by
approved_at
created_at
```

### 42.3 project_drafts

```text
id
project_id
manifest_version
manifest_yaml
source_type
submitted_by_type
submitted_by_id
status
validation_result_json
diff_json
created_at
reviewed_by
reviewed_at
```

---

## 43. AI 등록 관련 API

### Schema

```text
GET  /api/v1/manifest/schema
GET  /api/v1/manifest/template
GET  /api/v1/manifest/examples
POST /api/v1/manifest/validate
```

### Device Login

```text
POST /api/v1/auth/device
POST /api/v1/auth/device/approve
POST /api/v1/auth/device/token
POST /api/v1/auth/token/revoke
```

### Draft

```text
POST /api/v1/project-drafts
GET  /api/v1/project-drafts/:id
POST /api/v1/project-drafts/:id/validate
POST /api/v1/project-drafts/:id/approve
POST /api/v1/project-drafts/:id/reject
```

### Diff

```text
POST /api/v1/projects/:slug/diff
GET  /api/v1/projects/:slug/manifest
```

### OIDC

```text
POST /api/v1/auth/oidc/exchange
POST /api/v1/deployments
```

---

## 44. CLI 내부 구조

```text
packages/cli/
 ├─ commands/
 │   ├─ init.ts
 │   ├─ inspect.ts
 │   ├─ validate.ts
 │   ├─ diff.ts
 │   ├─ register.ts
 │   ├─ sync.ts
 │   ├─ login.ts
 │   └─ status.ts
 ├─ detectors/
 │   ├─ node.ts
 │   ├─ python.ts
 │   ├─ docker.ts
 │   ├─ database.ts
 │   ├─ github.ts
 │   └─ domain.ts
 ├─ schema/
 │   ├─ client.ts
 │   └─ cache.ts
 ├─ auth/
 │   ├─ device-flow.ts
 │   ├─ token-store.ts
 │   └─ oidc.ts
 ├─ manifest/
 │   ├─ generator.ts
 │   ├─ validator.ts
 │   ├─ merger.ts
 │   └─ diff.ts
 └─ api/
     └─ client.ts
```

### 44.1 로컬 Token 저장

운영체제 Keychain 사용을 우선한다.

```text
Windows Credential Manager
macOS Keychain
Linux Secret Service
```

Fallback으로 파일을 사용할 경우:

```text
~/.config/deployhub/credentials.json
```

조건:

- 사용자만 읽기 가능
- 평문 장기 Token 저장 금지
- 만료시간 포함
- `deployhub logout` 시 삭제

---

## 45. AI 등록 기능 개발단계

## 45.1 AI 등록 1단계

- Manifest v1 JSON Schema
- Template API
- `deployhub init`
- `deployhub init --detect`
- `deployhub validate`
- 일회용 등록 Token
- Draft 등록
- 관리화면 검토

## 45.2 AI 등록 2단계

- `deployhub inspect`
- `deployhub diff`
- 기존 프로젝트 Sync
- 탐지 근거와 Confidence
- Drift 표시
- AGENTS.md Template

## 45.3 AI 등록 3단계

- Device Login
- Access Token Scope
- CLI Keychain 저장
- Audit Log
- Token 폐기

## 45.4 AI 등록 4단계

- GitHub Actions OIDC
- Deployment Publish
- Repository Trust Policy
- Environment 제한

## 45.5 AI 등록 5단계

- MCP Server
- OAuth
- Tool별 Scope
- MCP Audit Log
- AI Client 연결 가이드

---

## 46. 변경된 전체 구현 우선순위

```text
1. Docker Compose 기반 DeployHub 인프라
2. PostgreSQL Schema
3. 인증 및 사용자 관리
4. 프로젝트·구성요소 CRUD
5. Manifest v1 Schema
6. DeployHub CLI init / detect / validate
7. 일회용 등록 Token
8. Project Draft 및 승인화면
9. Docker Collector
10. GitHub 연동
11. Vercel·Supabase·Hostinger Collector
12. Diff 및 Drift Detection
13. Device Login
14. Uptime Kuma와 알림
15. GitHub Actions OIDC
16. MCP Server
17. 비용·백업·운영 고도화
```

---

## 47. 최종 AI 등록 권고안

### MVP

```text
deployhub.yaml
  +
DeployHub CLI
  +
Manifest Schema API
  +
10분·1회용 등록 Token
  +
Draft 승인
```

### 정식 버전

```text
deployhub.yaml
  +
DeployHub CLI Device Login
  +
30분 단기 Access Token
  +
Project Scope
  +
Diff 및 Draft 승인
  +
GitHub Actions OIDC
```

### 확장 버전

```text
DeployHub MCP Server
  +
OAuth 사용자 승인
  +
Tool별 최소권한
  +
전체 Audit Log
```

최종 원칙은 다음과 같다.

> AI가 DeployHub Manifest 구조와 REST API를 직접 추측하지 않도록 하고, DeployHub CLI 또는 MCP가 최신 Schema를 제공하여 프로젝트 분석, Manifest 생성, 검증과 Draft 제출을 담당하게 한다.

