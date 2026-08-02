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
- 프로젝트별 대표 화면을 자동 캡처하거나 수동 업로드해 목록 카드와 상세 화면에서
  확인한다. 캡처 설정·업로드·이미지 조회는 로그인한 사용자에게만 허용한다.
- CLI가 저장소를 감지해 `deployhub.yaml` 초안을 만들고 Schema로 검증한다.
- 신규 등록과 변경 사항을 Draft로 제출해 사람의 승인 후 반영한다.
- GitHub OAuth와 허용 사용자 목록으로 관리 화면 접근을 제한한다.

## 시스템 구성

| 구성요소 | 역할 |
| --- | --- |
| `apps/web` | Next.js 기반 관리 화면, 인증, API와 Draft 검토 화면 |
| `apps/worker` | 상태 점검, Docker 정보 동기화, 스냅샷 예약과 백그라운드 작업 처리 |
| `apps/snapshotter` | 격리된 Playwright/Chromium으로 공개 웹 페이지를 WebP로 캡처 |
| PostgreSQL | 프로젝트, 구성요소, 상태, 배포, Draft와 현재 스냅샷 이미지 저장 |
| Docker Socket Proxy | 워커에 제한된 Docker 조회 API만 제공 |
| `@deployhub/cli` | 저장소 감지, manifest 검증, 상태·차이 조회와 Draft 제출 |

저장소는 pnpm workspace 모노레포이며, 공통 데이터베이스·수집기·manifest·공유
코드는 `packages/` 아래에 있다. 운영 환경에서는 Docker Compose로 웹, 워커,
snapshotter, PostgreSQL과 Socket Proxy를 실행하고 Caddy가 HTTPS 요청을 웹
컨테이너로 전달한다. snapshotter는 worker와 전용 네트워크만 공유하며 호스트
포트, 데이터베이스 자격 증명과 Docker 소켓을 받지 않는다.

## 요구사항

- Node.js 22 이상
- pnpm 9.15.0
- Docker 데몬: `pnpm test`의 PostgreSQL 통합 테스트(Testcontainers)와 컨테이너 실행에 필요
- Docker Compose: PostgreSQL 또는 전체 서비스 스택 실행에 필요

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
pnpm --filter snapshotter build
pnpm --filter @deployhub/cli build
```

PostgreSQL 마이그레이션과 전체 Compose 실행 절차는 운영 환경의 네트워크·환경변수
설정에 의존하므로 [배포 가이드](./docs/deployment.md)를 따른다.

## 프로젝트 스냅샷

프로젝트 편집 화면에서 대표 URL과 스냅샷 모드를 설정한다.

- `automatic`: Docker의 새 `running` 운영 배포 또는 Vercel의 새 `READY` 운영
  배포가 처음 관측되면 공개 HTTP(S) 대표 URL을 캡처한다. 로그인 세션, 쿠키,
  브라우저 프로필이나 자격 증명은 snapshotter에 전달하지 않으므로 인증이 필요한
  페이지에는 사용하지 않는다.
- `manual`: 로그인한 관리자가 PNG/JPEG/WebP 파일을 업로드해 현재 이미지를
  고정한다. 이후 자동 캡처 결과가 이 이미지를 덮어쓰지 않으며, 자동 모드를
  재개하면 다음 캡처를 즉시 예약한다.
- `disabled`: 자동 캡처를 예약하지 않는다. 기존 이미지는 별도 삭제 전까지
  유지된다.

자동 캡처와 수동 업로드 결과는 1440×900 WebP, 최대 1.5 MB로 정규화되어
PostgreSQL에 저장된다. 수동 업로드 원본은 최대 5 MB다. 목록 쿼리는 이미지
바이트를 읽지 않고 메타데이터만 가져오며, 실제 이미지는 인증된 전용 API에서
지연 로드한다. 자동 대상은 DNS와 모든 요청·리다이렉트 단계에서 공개 주소인지
재검증한다.

## DeployHub CLI

Node.js 22 이상에서 전역 설치 없이 `npx`로 바로 실행할 수 있다.
먼저 현재 터미널에 관리자가 제공한 서버 URL이 `DEPLOYHUB_URL`로 설정되어 있어야 한다.

```bash
npx @deployhub/cli init --detect
```

CLI는 서버 URL이나 인증 토큰에 기본값을 사용하지 않는다. 서버 URL은
`DEPLOYHUB_URL`, 상태·차이 조회와 Draft 제출에 쓰는 인증 토큰은 `DEPLOYHUB_TOKEN` 환경변수로 전달한다.
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
| Playwright | 1.62.0 |
| sharp | 0.35.3 |
| Caddy | 2.11.4 |
| caddy-ratelimit | v0.1.1-0.20260612195517-5625512f24f6 |

## 라이선스

[MIT](./LICENSE)
