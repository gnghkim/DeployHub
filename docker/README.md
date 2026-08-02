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

4. web, worker, snapshotter를 기동한다. web과 worker는 동일한
   `deployhub:${TAG:-local}` 이미지를 사용하고 Compose의 `command`로 실행
   파일을 나눈다. worker는 snapshotter health에 의존하지 않으므로 캡처 서비스가
   내려가도 다른 작업을 계속 처리한다.

   ```sh
   docker compose --env-file .env -f docker/compose.yml up -d web worker snapshotter
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

빌드 단계는 Debian/glibc 기반 `node:22.22.0-bookworm-slim`으로, 런타임은
`mcr.microsoft.com/playwright:v1.62.0-noble`로 고정한다. Dockerfile frontend를
포함한 세 공급 루트 모두 사람이 읽을 수 있는 태그와 검증한 multi-arch manifest
digest를 함께 쓴다. 빌드는 snapshotter dependency closure만 먼저 fetch하고,
이후 install/build/prune 단계는 네트워크를 끈 상태에서 offline으로 실행한다.
여기서 만든 프로덕션 `node_modules`와 번들만 런타임으로 복사한다.

현재 고정한 manifest digest는 Dockerfile frontend
`sha256:87999aa3d42bdc6bea60565083ee17e86d1f3339802f543c0d03998580f9cb89`,
Node builder
`sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94`,
Playwright runtime
`sha256:baed2032d533817f3dbe6425de795788430ba345e819a1201337009ba17c9d07`이다.

앱의 Playwright 패키지도 1.62.0으로 고정하며 설치 중 브라우저를 다시 받지 않는다.
공식 런타임은 Chromium 외에 현재 사용하지 않는 Firefox와 WebKit 바이너리도
포함해 이미지가 크다. 브라우저/시스템 의존성의 무결성을 해칠 수 있는 수동
pruning 대신 이 크기를 받아들인다. 최종 이미지는 `pwuser`로 실행하고 모든
capability를 drop하며 `no-new-privileges`, read-only root filesystem, Chromium
사용자 네임스페이스 sandbox를 사용한다. `--no-sandbox`, root, `privileged`,
`SYS_ADMIN`, `seccomp=unconfined`는 사용하지 않는다.

`playwright-seccomp.json`은 Playwright v1.62.0의 공식 전체 프로필을 기준으로
체크인한 것이다:
`https://raw.githubusercontent.com/microsoft/playwright/v1.62.0/utils/docker/seccomp_profile.json`.
Docker 기본 허용 목록에 Chromium 샌드박스가 필요한 `clone`, `setns`,
`unshare` 사용자 네임스페이스 호출을 추가한 upstream 프로필에 `chroot`를
명시적으로 허용한다. `cap_drop: ALL`이면 upstream의 `CAP_SYS_CHROOT` 조건부
규칙이 선택되지 않지만 Chromium은 새 사용자 namespace 안에서 sandbox root를
만들기 위해 이 syscall이 필요하다. syscall을 허용해도 커널의 namespace capability
검사는 그대로 적용되며 컨테이너에 capability를 다시 부여하지 않는다.

컨테이너는 worker와 공유하는 `snapshot` 네트워크에만 연결되며 `deployhub`,
`docker-api`, `web` 네트워크에는 절대 연결하지 않는다. 호스트 포트를 열지 않고
`.env`, 데이터베이스 자격 증명, `DATABASE_URL`, `DOCKER_HOST`, Docker socket을
받지 않는다. 정상 renderer HTTP(S) 트래픽은 DNS를 고정하고 목적지를 검증하는
내부 validating proxy를 반드시 통과한다.

`snapshot` 네트워크는 공개 캡처 대상에 필요한 egress를 허용한다. 브라우저
sandbox까지 탈출한 공격자가 직접 host/LAN socket을 여는 경우는 애플리케이션
proxy만으로 막을 수 없는 배포 계층의 잔여 위험이다. 운영 호스트 firewall/egress
정책에서 컨테이너의 private, loopback, link-local, carrier-grade NAT, IPv6 ULA,
cloud metadata 대역과 Docker host/bridge gateway 접근을 거부하고 필요한 공개
HTTP(S)/DNS만 허용해야 한다. 별도 egress gateway는 새 배포 서비스와 proxy
transport 변경이 필요하므로 이 경계의 구성요소로 추가하지 않는다. 로그인이나
세션이 필요한 페이지는 자동 캡처하지 않으며 사람이 확인하고 수동 등록한다.

브라우저 폭주를 제한하기 위해 CPU 2개, 메모리 2 GiB, PID 256개,
`/dev/shm` 1 GiB, 열린 파일 soft/hard 1024/2048 제한을 둔다. root filesystem은
read-only이고 Chromium 임시 프로필에는 `nosuid,nodev,noexec`인 512 MiB `/tmp`
tmpfs만 제공한다. healthcheck는 공개 route나 호스트 포트를 추가하지 않는다.
컨테이너 내부에서 `GET /__health`를 호출하고 기존 애플리케이션이 반환하는
결정적인 404 `blocked_target` 응답을 확인한다.

digest나 버전을 갱신할 때는 다음 명령으로 태그의 manifest digest를 확인한다.

```sh
docker buildx imagetools inspect docker/dockerfile:1
docker buildx imagetools inspect node:22.22.0-bookworm-slim
docker buildx imagetools inspect mcr.microsoft.com/playwright:v1.62.0-noble
```

Node patch는 builder 태그/digest를 함께 바꾼다. Playwright patch는 npm package,
runtime 태그/digest, upstream seccomp profile 버전을 한 번에 맞춘다. 그 뒤
root lockfile을 갱신하고 snapshotter 전용 lockfile은 다음처럼 기계적으로 다시
만든다.

```sh
pnpm --dir apps/snapshotter install --lockfile-only --ignore-workspace --ignore-scripts
```

이후 cache-free build, Playwright/Sharp import, non-root/security inspection, 실제 캡처와
redirect 5/6 smoke test를 모두 통과시킨 뒤 반영한다.

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
