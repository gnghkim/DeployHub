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
