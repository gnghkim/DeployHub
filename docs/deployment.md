# DeployHub 배포 런북

> Hostinger VPS + 가비아 DNS + Docker Compose 기준.
> 모든 명령은 검증된 것만 실었다. 로컬 compose 스택에서 실제로 실행해 확인했다.

이 문서의 `<...>` 자리표시자를 실제 값으로 바꿔 쓴다. **실제 도메인과 IP는 이 저장소에 적지 않는다** — 공개 저장소이므로 인프라 구성이 영구히 노출된다.

## 전제: 공용 서버

배포 대상 VPS는 **전용 서버가 아니다.** 여러 프로젝트가 함께 돌고, 하나의 공용 Caddy가 80/443을 점유한 채 `web` 네트워크에서 각 컨테이너로 프록시한다.

```
공용 Caddy (caddy:2, 포트 80/443, 네트워크 web)
 ├─ <다른 서비스들>
 └─ hub.<도메인>  →  deployhub-web:3000     ← 우리가 추가할 블록
```

따라서 이 저장소의 compose는 아래와 같이 동작한다.

- **자체 Caddy를 띄우지 않는다.** `standalone` 프로파일 뒤에 있어 기본으로 뜨지 않는다. 함께 띄우면 포트 충돌로 **기존 서비스가 전부 죽는다.**
- **호스트 포트를 하나도 열지 않는다.** 외부 노출은 공용 Caddy가 전담한다.
- `deployhub-web`이 내부망(`deployhub`)과 공유망(`web`)에 모두 붙는다. 전자는 postgres 접근용, 후자는 공용 Caddy가 닿기 위함이다.

전용 서버에 새로 설치한다면 `compose.yml`의 `web` 네트워크에서 `external: true`를 지우고 `--profile standalone`으로 자체 Caddy를 띄운다.

**레이트리밋은 적용되지 않는다.** 공용 Caddy가 stock 이미지라 모듈이 없다. 구축방안 R12에 부채로 기록했고 되살리는 두 경로도 거기 있다.

---

## 0. 준비물

시작 전에 아래가 있어야 한다.

| 항목 | 확인 방법 |
|---|---|
| VPS 공인 IP | Hostinger 콘솔 |
| SSH 접속 | `ssh root@<VPS-IP>` 로 들어가짐 |
| 도메인 | 가비아에 보유 중 |
| GitHub 계정 | OAuth App 을 만들 수 있는 권한 |

---

## 1. DNS — 가비아에서 A 레코드 지정

가비아 관리 콘솔 → 도메인 → DNS 관리에서 A 레코드를 추가한다.

```
호스트   hub          (또는 원하는 서브도메인)
타입     A
값       <VPS-IP>
TTL      600
```

**이 단계를 먼저 해야 한다.** Let's Encrypt 는 HTTP-01 방식으로 도메인 소유를 검증하므로, DNS 가 VPS 를 가리키기 전에 Caddy 를 띄우면 인증서 발급이 실패한다.

전파 확인:

```bash
nslookup hub.<도메인>
```

`<VPS-IP>` 가 나올 때까지 기다린다. 보통 몇 분, 길면 한 시간.

---

## 2. GitHub OAuth App 생성

<https://github.com/settings/developers> → New OAuth App

```
Application name          DeployHub
Homepage URL              https://hub.<도메인>
Authorization callback URL  https://hub.<도메인>/api/auth/callback/github
```

**콜백 URL 이 정확해야 한다.** 경로가 하나라도 다르면 로그인 마지막 단계에서 실패한다.

생성 후 **Client ID** 를 적어두고, **Generate a new client secret** 으로 secret 을 만들어 적어둔다. secret 은 이 화면을 벗어나면 다시 볼 수 없다.

---

## 3. VPS 기본 설정

```bash
ssh root@<VPS-IP>
```

Docker 확인 (없으면 설치):

```bash
docker --version && docker compose version
```

없다면:

```bash
curl -fsSL https://get.docker.com | sh
```

방화벽 — 공용 서버에는 이미 다른 서비스가 80/443 을 쓰고 있으므로 보통 열려 있다. 상태만 확인한다.

```bash
sudo ufw status numbered
```

**`5432` 나 다른 DB 포트가 열려 있으면 안 된다.** 우리 compose 는 호스트 포트를 하나도 열지 않으므로 추가 작업은 필요 없다.

`sudo` 가 비밀번호를 요구하면 이 명령만 직접 실행한다.

---

## 4. 저장소 가져오기

```bash
mkdir -p /opt && cd /opt
git clone https://github.com/gnghkim/DeployHub.git
cd DeployHub
```

---

## 5. 비밀값 생성과 `.env` 작성

세 값을 서버에서 생성한다. 화면에 찍힌 값은 `.env` 에만 들어가고 다른 곳에 남기지 않는다.

```bash
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
echo "AUTH_SECRET=$(openssl rand -base64 32)"
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)"
```

`ENCRYPTION_KEY` 는 반드시 base64 32바이트여야 한다. 앱이 기동 시 길이를 검사하고 틀리면 즉시 실패한다.

`.env` 를 만든다:

```bash
cp .env.example .env
nano .env
```

채울 내용:

```
POSTGRES_PASSWORD=<위에서 생성한 값>
DATABASE_URL=postgresql://deployhub:<POSTGRES_PASSWORD와 같은 값>@postgres:5432/deployhub
NODE_ENV=production

AUTH_SECRET=<위에서 생성한 값>
AUTH_GITHUB_ID=<GitHub OAuth Client ID>
AUTH_GITHUB_SECRET=<GitHub OAuth Client Secret>
ALLOWED_GITHUB_LOGINS=gnghkim
ENCRYPTION_KEY=<위에서 생성한 값>

AUTH_TRUST_HOST=true
AUTH_URL=https://hub.<도메인>

HUB_DOMAIN=hub.<도메인>
ACME_EMAIL=<본인 이메일>
```

주의할 점 셋.

- `DATABASE_URL` 의 호스트는 `postgres` 다. `localhost` 가 아니다. 컨테이너 네트워크 이름이다.
- `AUTH_TRUST_HOST=true` 가 없으면 Caddy 뒤에서 Auth.js 가 모든 인증 요청을 `UntrustedHost` 로 거부한다.
- `ALLOWED_GITHUB_LOGINS` 가 비어 있으면 **아무도 로그인할 수 없다.** 설계상 fail-closed 다.

권한을 좁힌다:

```bash
chmod 600 .env
```

---

## 6. 이미지 빌드

```bash
docker compose --env-file .env -f docker/compose.yml build
docker compose --env-file .env -f docker/compose.yml --profile tools build migrate
```

**두 줄 다 실행해야 한다.** `docker compose build` 는 프로파일에 속한 서비스를 조용히 건너뛴다. `migrate` 는 `profiles: ["tools"]` 라 첫 줄로는 다시 빌드되지 않는다.

이걸 빠뜨리면 다음 단계가 **거짓 성공**을 낸다. 낡은 migrate 이미지에는 새 `.sql` 파일이 없으니 drizzle 은 적용할 게 없다고 판단하고 `migrations applied successfully!` 를 출력한다. 테이블은 생기지 않는다. 2026-07-27 에 0005 에서 실제로 겪었다.

빌드 후 이미지 안에 최신 마이그레이션이 들어갔는지 확인한다:

```bash
docker run --rm --entrypoint sh deployhub-migrate:local -c 'ls /app/drizzle/*.sql' | tail -3
```

`deployhub:local` 은 web 과 worker 가 공유하고 `command` 로 갈린다. 자체 Caddy 이미지는 `standalone` 프로파일에 있어 여기서 빌드되지 않는다(공용 Caddy 를 쓰는 서버에서는 필요 없다).

수 분 걸린다. 마지막에 `Built` 가 보이면 성공이다.

---

## 7. PostgreSQL 기동

```bash
docker compose --env-file .env -f docker/compose.yml up -d postgres
docker inspect deployhub-postgres --format '{{.State.Health.Status}}'
```

`healthy` 가 나올 때까지 기다린다. 10초쯤 걸린다.

---

## 8. 마이그레이션

```bash
docker compose --env-file .env -f docker/compose.yml --profile tools run --rm migrate
```

`migrations applied successfully!` 가 나오면 된다. **다만 이 메시지만 믿지 말고 아래 테이블 확인까지 해라.** 낡은 이미지로 돌면 같은 메시지가 나온다(6장 참고).

이 명령은 **여러 번 실행해도 안전하다.** drizzle 이 `drizzle.__drizzle_migrations` 에 적용 이력을 기록하므로 이미 적용된 것은 건너뛴다.

테이블 확인:

```bash
docker compose --env-file .env -f docker/compose.yml exec postgres \
  psql -U deployhub -d deployhub -tAc \
  "select tablename from pg_tables where schemaname='public' order by 1;"
```

7개가 나와야 한다 — `component_resources`, `components`, `jobs`, `projects`, `provider_accounts`, `resources`, `users`.

---

## 9. web·worker·socket-proxy 기동

```bash
docker compose --env-file .env -f docker/compose.yml up -d
docker compose --env-file .env -f docker/compose.yml ps
docker compose --env-file .env -f docker/compose.yml logs worker | tail -5
```

worker 로그에 `[worker] 시작 worker-xxxxxxxx` 가 보여야 한다.

web 이 응답하는지 확인 (아직 외부 노출 전):

```bash
docker compose --env-file .env -f docker/compose.yml exec web \
  node -e "fetch('http://localhost:3000/').then(r=>console.log('status',r.status))"
```

`status 307` 이 정상이다 — 미인증이라 로그인으로 보내는 것이다.

공용 Caddy 가 있는 `web` 네트워크에서도 닿는지 확인한다. 이것이 되어야 10단계가 동작한다.

```bash
docker run --rm --network web curlimages/curl:latest \
  -s -o /dev/null -w '%{http_code}\n' http://deployhub-web:3000/
```

`307` 이 나와야 한다.

### socket-proxy 격리 확인

`socket-proxy` 는 `/var/run/docker.sock` 을 읽기 전용으로 쥔다. 이 소켓은 사실상 호스트 root 권한이므로, 닿을 수 있는 범위를 좁게 유지하는 것이 이 컨테이너를 두는 조건이다. 구조는 두 겹이다.

- `docker-api` 네트워크가 `internal: true` 다. worker 와 socket-proxy 만 여기 붙는다. **web 은 붙지 않는다** — 외부 요청을 직접 받는 쪽이라, 거기서 Docker API 에 닿으면 격리가 무의미해진다.
- socket-proxy 자체가 `POST: 0` 이라 읽기만 통과시킨다.

배포할 때마다 두 겹이 다 살아 있는지 실측한다. 읽고 넘기지 말고 실제로 실행해라.

```bash
# web 에서는 닿지 않아야 한다 → "차단됨"
docker exec deployhub-web node -e \
  "fetch('http://socket-proxy:2375/_ping',{signal:AbortSignal.timeout(4000)}).then(r=>console.log('도달함',r.status)).catch(e=>console.log('차단됨'))"

# worker 에서는 닿아야 한다 → "도달함 200"
docker exec deployhub-worker node -e \
  "fetch('http://socket-proxy:2375/_ping',{signal:AbortSignal.timeout(4000)}).then(r=>console.log('도달함',r.status)).catch(e=>console.log('차단됨'))"

# 쓰기는 막혀야 한다 → 403
docker exec deployhub-worker node -e \
  "fetch('http://socket-proxy:2375/containers/create',{method:'POST',headers:{'content-type':'application/json'},body:'{}',signal:AbortSignal.timeout(4000)}).then(r=>console.log('POST',r.status))"
```

`web` 에서 `도달함` 이 나오면 격리가 깨진 것이다. 배포를 멈추고 `docker/compose.yml` 의 `networks:` 를 확인해라.

이미지는 다이제스트로 고정되어 있다. 올릴 때는 릴리스 노트를 읽고 `compose.yml` 의 다이제스트를 함께 갱신한다 — 태그만 바꾸면 고정한 의미가 없다.

---

## 10. 공용 Caddy 에 site 블록 추가 — 여기서 인증서가 발급된다

**1단계의 DNS 전파가 끝났는지 먼저 확인한다.** 끝나기 전에 추가하면 인증서 발급이 실패한다.

공용 Caddyfile 을 백업하고 블록을 덧붙인다.

```bash
cp /opt/caddy/Caddyfile /opt/caddy/Caddyfile.bak.$(date +%F-%H%M)

cat >> /opt/caddy/Caddyfile <<'EOF'

# BEGIN DEPLOYHUB
hub.<도메인> {
	encode zstd gzip
	reverse_proxy deployhub-web:3000
}
# END DEPLOYHUB
EOF
```

문법을 먼저 검증한다. **검증 없이 reload 하면 기존 서비스가 함께 멈출 수 있다.**

```bash
docker exec caddy-caddy-1 caddy validate --config /etc/caddy/Caddyfile
```

`Valid configuration` 이 나오면 무중단으로 적용한다.

```bash
docker exec caddy-caddy-1 caddy reload --config /etc/caddy/Caddyfile
docker logs caddy-caddy-1 --tail 30
```

`certificate obtained successfully` 가 보이면 성공이다.

발급이 실패하면 대부분 DNS 문제다. 블록의 도메인이 `.env` 의 `HUB_DOMAIN` 과 같은지, 그 도메인이 VPS IP 를 가리키는지 확인한다.

되돌리려면 백업을 복원하고 reload 한다.

```bash
cp /opt/caddy/Caddyfile.bak.<타임스탬프> /opt/caddy/Caddyfile
docker exec caddy-caddy-1 caddy reload --config /etc/caddy/Caddyfile
```

---

## 11. 검증

브라우저에서 `https://hub.<도메인>` 을 연다.

| 확인 | 기대 |
|---|---|
| HTTPS 접속 | 인증서 경고 없이 열림 |
| 로그인 화면 | GitHub 로그인 버튼 |
| GitHub 로그인 | 성공 후 Overview 화면 |
| 허용 목록 밖 계정 | 로그인 거부 |

IP 직접 접근이 차단되는지도 확인한다:

```bash
curl -sk -o /dev/null -w "%{http_code}\n" https://<VPS-IP>/
```

빈 응답이나 연결 끊김이 정상이다. 앱 화면이 나오면 Caddyfile 의 호스트명 차단 블록이 동작하지 않는 것이다.

포트 노출도 다시 확인한다:

```bash
docker compose --env-file .env -f docker/compose.yml ps --format "{{.Service}}\t{{.Ports}}"
```

**모든 줄이 비어 있어야 한다.** 우리 스택은 호스트 포트를 열지 않는다. 80/443 은 공용 Caddy 가 점유하며 그것은 이 compose 소관이 아니다.

---

## 12. GitHub 토큰 등록과 첫 수집

<https://github.com/settings/tokens> 에서 **read-only** 토큰을 만든다.

- Fine-grained token 권장
- Repository access: All repositories (또는 관리할 저장소만)
- Permissions: `Contents: Read-only`, `Metadata: Read-only`, `Actions: Read-only`

DeployHub 화면 → **Providers** → GitHub 계정 추가 → 토큰 입력 → 연결 테스트 → 동기화.

토큰은 AES-256-GCM 으로 암호화되어 저장되고, 화면에는 마지막 4자리만 표시된다.

동기화 후 **Resources** 화면에서 저장소 목록, 마지막 커밋, 워크플로 결과를 확인한다.

---

## 운영 메모

### 재배포

**먼저 배포 경로와 저장소 소유자를 확인한다.** 4장은 `/opt` 에 clone 하지만 실제 서버가
거기 있다는 보장이 없다. 돌고 있는 컨테이너에게 직접 물어본다.

```bash
docker inspect deployhub-web \
  --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}'
# 출력은 compose 파일이 있는 docker/ 디렉터리다. 저장소 루트는 그 상위.
stat -c %U <저장소-루트>
```

**소유자가 root 가 아니면 git 명령을 root 로 실행하지 마라.** git 이
`detected dubious ownership` 로 거부한다. `safe.directory` 를 root 에 추가하는 대신
소유자로 실행한다 — 파일 소유권이 섞이면 이후 배포가 더 꼬인다.

```bash
cd <저장소-루트>
sudo -u <소유자> git -C <저장소-루트> pull --ff-only
docker compose --env-file .env -f docker/compose.yml build
docker compose --env-file .env -f docker/compose.yml --profile tools build migrate   # 빠뜨리면 마이그레이션이 거짓 성공한다
docker compose --env-file .env -f docker/compose.yml --profile tools run --rm migrate
docker compose --env-file .env -f docker/compose.yml up -d
```

마이그레이션이 있는 갱신이라면 **적용 메시지를 믿지 말고 스키마를 직접 확인한다.**
테이블이 새로 생기는 변경이라면:

```bash
docker exec deployhub-postgres psql -U deployhub -d deployhub -tAc \
  "select table_name from information_schema.tables where table_schema='public' order by 1"
```

컬럼만 늘어나는 변경이라면 테이블 목록은 그대로이므로 해당 테이블을 본다:

```bash
docker exec deployhub-postgres psql -U deployhub -d deployhub -c "\d <테이블>"
```

### 로그

```bash
docker compose --env-file .env -f docker/compose.yml logs -f web
docker compose --env-file .env -f docker/compose.yml logs -f worker
```

### 백업 (구축방안 9.1)

`.env` 와 `ENCRYPTION_KEY` 는 **DB 덤프와 같은 곳에 두지 않는다.** 같이 새면 암호화가 무의미하다.

```bash
docker compose --env-file .env -f docker/compose.yml exec -T postgres \
  pg_dump -U deployhub deployhub | gzip > deployhub-$(date +%F).sql.gz
```

이 파일을 외부 스토리지로 옮긴다. `.env` 와 키는 패스워드 매니저에 별도 보관한다.

### 알아둘 것

- **감시자를 감시할 자가 없다.** DeployHub 가 죽으면 알림도 죽는다. 구축방안 R7 이 외부 dead man's switch 를 M3 항목으로 잡아두었다.
- **오리진 IP 가 노출된다.** 가비아 DNS 에는 프록시 계층이 없다. 구축방안 3.2·R6 에 완화책과 Tailscale 전환 경로가 있다.
- **다중 사용자 전환 시 권한 구멍.** 구축방안 R11. `ALLOWED_GITHUB_LOGINS` 에 신뢰 수준이 다른 사람을 추가하기 전에 반드시 읽는다.
