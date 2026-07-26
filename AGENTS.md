# DeployHub Registration

이 프로젝트의 기술 구성이나 배포 환경이 변경되면 DeployHub 정보를
갱신한다. 모든 명령은 저장소 루트에서 실행한다.

사전 준비:

- `DEPLOYHUB_URL`은 DeployHub 서버 URL로 설정되어 있어야 한다.
- Draft 제출 시에만 `DEPLOYHUB_TOKEN`을 환경변수로 전달한다.
- 토큰, 사용자 비밀번호, Provider Secret 등 비밀값을 파일, 명령 인자,
  로그 또는 대화에 기록하지 않는다.
- 먼저 `pnpm --filter @deployhub/cli build`로 CLI를 빌드한다.

신규 프로젝트:

1. `node packages/cli/dist/index.js init --detect`
2. 출력된 `INFERRED FIELDS`와 `UNKNOWN FIELDS`를 검토하고 확인된 값만
   `deployhub.yaml`에 보완한다.
3. `node packages/cli/dist/index.js validate`
4. `node packages/cli/dist/index.js register --draft`
5. 출력된 Draft URL에서 사람이 검토하고 승인한다.

기존 프로젝트:

1. `node packages/cli/dist/index.js status`
2. `node packages/cli/dist/index.js diff`
3. 필요한 경우 `deployhub.yaml`을 수정한다.
4. `node packages/cli/dist/index.js validate`
5. `node packages/cli/dist/index.js sync --draft`
6. 출력된 Draft URL에서 사람이 변경 내용을 검토하고 승인한다.

YAML 구조를 임의로 추측하지 않는다. 반드시 CLI가 생성한 manifest와
`deployhub.yaml` 첫 줄의 최신 Schema를 사용하며, 검증에 실패한 manifest는
제출하지 않는다.
