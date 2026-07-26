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
