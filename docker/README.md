# Docker Compose 기동

모든 명령은 저장소 루트에서 실행한다. 먼저 `.env.example`을 `.env`로
복사하고 로컬 또는 배포 환경의 값을 채운다. `.env`는 Git에서 제외되며
커밋하지 않는다.

## 기동 순서

1. web과 worker가 함께 들어 있는 애플리케이션 이미지와
   `caddy-ratelimit` 모듈이 포함된 Caddy 이미지를 빌드한다.

   ```sh
   docker compose --env-file .env -f docker/compose.yml build
   ```

2. PostgreSQL을 먼저 기동하고 `healthy` 상태를 확인한다.

   ```sh
   docker compose --env-file .env -f docker/compose.yml up -d postgres
   docker compose --env-file .env -f docker/compose.yml ps postgres
   ```

3. `DATABASE_URL`이 설정된 관리 프로세스에서 마이그레이션을 적용한다.
   PostgreSQL 포트는 호스트에 공개하지 않으므로, 이 명령은 `deployhub`
   Docker 네트워크에 연결된 배포 작업이나 관리 컨테이너에서 실행한다.

   ```sh
   pnpm --filter @deployhub/db exec drizzle-kit migrate
   ```

4. web과 worker를 기동한다. 두 서비스는 동일한 `deployhub:${TAG:-local}`
   이미지를 사용하고 Compose의 `command`로 실행 파일을 나눈다.

   ```sh
   docker compose --env-file .env -f docker/compose.yml up -d web worker
   docker compose --env-file .env -f docker/compose.yml logs worker
   ```

5. `HUB_DOMAIN`의 DNS가 서버를 가리키는 배포 환경에서 Caddy를 마지막으로
   기동한다. 호스트에는 Caddy의 80/443 포트만 공개된다.

   ```sh
   docker compose --env-file .env -f docker/compose.yml up -d caddy
   ```

## Caddy 설정 검증

실제 도메인으로 로컬 ACME 인증서 발급을 시도하지 않고, 커스텀 이미지에서
설정 문법만 검증한다.

```sh
docker compose --env-file .env -f docker/compose.yml run --rm --no-deps caddy \
  caddy validate --config /etc/caddy/Caddyfile
```

`caddy-ratelimit`은 `github.com/mholt/caddy-ratelimit`의
`5625512f24f6f59d6f64fb3aafe5eecff0b286db` 커밋으로 고정했다.

## Snapshotter 보안 경계

Snapshotter 이미지는 브라우저와 시스템 의존성이 포함된
`mcr.microsoft.com/playwright:v1.62.0-noble`을 빌드와 런타임에 모두 사용한다.
앱의 Playwright 패키지도 1.62.0으로 고정하며, 설치 중 브라우저를 다시 받지
않는다. 최종 이미지에는 프로덕션 `node_modules`와 번들만 복사하고 `pwuser`로
실행한다. Chromium 사용자 네임스페이스 샌드박스를 켜며 `--no-sandbox`, root,
`privileged`, `SYS_ADMIN`, `seccomp=unconfined`는 사용하지 않는다.

`playwright-seccomp.json`은 Playwright v1.62.0의 공식 전체 프로필을 그대로
체크인한 것이다:
`https://raw.githubusercontent.com/microsoft/playwright/v1.62.0/utils/docker/seccomp_profile.json`.
Docker 기본 허용 목록에 Chromium 샌드박스가 필요한 `clone`, `setns`,
`unshare` 사용자 네임스페이스 호출만 추가한 upstream 프로필이다.

컨테이너는 worker와 공유하는 `snapshot` 네트워크에만 연결된다. 호스트 포트를
열지 않고 `.env`, 데이터베이스 자격 증명, `DATABASE_URL`, `DOCKER_HOST`,
Docker socket을 받지 않는다. `snapshot` 네트워크는 캡처 대상에 접근할 수 있게
외부 egress를 허용하지만 snapshotter를 `deployhub`, `docker-api`, `web`
네트워크에 연결하지 않는다. 로그인이나 세션이 필요한 페이지는 자동 캡처하지
않으며 사람이 별도로 확인하고 수동으로 이미지를 등록한다.

브라우저 폭주를 제한하기 위해 메모리 2 GiB, PID 256개, `/dev/shm` 1 GiB,
열린 파일 soft/hard 1024/2048 제한을 둔다. healthcheck는 공개 HTTP 경로를
추가하지 않고 컨테이너 내부에서 3001번 TCP listen 상태만 확인한다. worker는
snapshotter의 health에 의존해 시작을 막지 않으므로 캡처 서비스가 내려가도 다른
작업을 계속 처리할 수 있다.

빌드와 기본 점검:

```sh
docker compose --env-file .env -f docker/compose.yml build snapshotter
docker compose --env-file .env -f docker/compose.yml run --rm --no-deps snapshotter \
  node --input-type=module -e "await Promise.all([import('playwright'), import('sharp')]); console.log(process.getuid())"
docker compose --env-file .env -f docker/compose.yml up -d snapshotter
docker compose --env-file .env -f docker/compose.yml ps snapshotter
```

호스트 포트를 만들지 않는 실제 캡처 smoke test는 실행 중인 worker에서 호출한다.
응답 본문은 출력하지 않는다.

```sh
docker compose --env-file .env -f docker/compose.yml exec -T worker \
  node --input-type=module -e "const r=await fetch(process.env.SNAPSHOTTER_URL+'/capture',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url:'https://example.com',viewport:{width:1440,height:900}})}); console.log(r.status,r.headers.get('content-type'),r.headers.get('x-image-width'),r.headers.get('x-image-height'),(await r.arrayBuffer()).byteLength)"
```
