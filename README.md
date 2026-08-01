# DeployHub

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
| Caddy | 2.11.4 |
| caddy-ratelimit | v0.1.1-0.20260612195517-5625512f24f6 |

## DeployHub CLI

Node.js 22 이상에서 npm 공개 패키지를 설치해 사용할 수 있다.

```bash
export DEPLOYHUB_URL="https://deployhub.example.invalid"
npx @deployhub/cli init --detect
```

설치 없이 `npx`로 바로 실행한다. 자주 쓴다면
`npm install --global @deployhub/cli` 후 `deployhub` 명령을 써도 된다.

예시 URL은 관리자가 제공한 DeployHub 서버 URL로 바꾼다.
CLI는 서버 URL이나 등록 토큰에 기본값을 사용하지 않는다. 서버 URL은
`DEPLOYHUB_URL`, Draft 제출용 일회성 토큰은 `DEPLOYHUB_TOKEN` 환경변수로
전달한다. 토큰을 명령 인자로 전달하거나 파일에 저장하지 않는다.

```bash
pnpm --filter @deployhub/cli build
node packages/cli/dist/index.js init --detect
node packages/cli/dist/index.js validate
node packages/cli/dist/index.js register --draft

node packages/cli/dist/index.js status
node packages/cli/dist/index.js diff
node packages/cli/dist/index.js sync --draft
```

`register`와 `sync`는 로컬 검증을 통과한 manifest만 Draft로 제출한다.
`diff`에서 manifest에 없는 기존 구성요소는 표시만 하며 자동 삭제하지
않는다. 자세한 AI 작업 절차는 [AGENTS.md](./AGENTS.md)를 따른다.

토큰 발급부터 Draft 승인까지 등록 절차 전체는
[프로젝트 등록 가이드](./docs/project-registration.md)에 정리되어 있다.

다른 저장소에서 AI 에이전트가 같은 절차를 따르게 하려면
[DeployHub AGENTS 템플릿](./templates/AGENTS.deployhub.md)을 그 저장소의
기존 지침에 합쳐 사용한다. 기존 `AGENTS.md`를 덮어쓰지 않는다.

관리자가 npm에 새 버전을 올리는 절차는
[CLI npm 게시 절차](./docs/cli-npm-publishing.md)에 정리되어 있다.

## 라이선스

MIT
