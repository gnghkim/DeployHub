# DeployHub Registration

프로젝트의 기술 구성이나 배포 환경이 변경되면 DeployHub 정보를 갱신한다.
모든 명령은 저장소 루트에서 실행한다.

사전 준비:

- Node.js 22 이상과 `@deployhub/cli`를 설치하고 `deployhub` 명령을 사용할 수
  있어야 한다.
- `DEPLOYHUB_URL`은 관리자가 제공한 DeployHub 서버 URL로 설정한다.
- `DEPLOYHUB_TOKEN`은 명령 인자가 아닌 환경변수로만 전달한다.
- 토큰, 사용자 비밀번호, Provider Secret 등 비밀값을 파일, 명령 인자,
  로그 또는 대화에 기록하지 않는다.

명령별 토큰 요구사항:

| 명령 | `DEPLOYHUB_TOKEN` |
|---|---|
| `init`, `validate` (`--remote` 포함) | 불필요 |
| `register --draft`, `sync --draft`, `diff`, `status` | 필수 |

신규 프로젝트:

1. `deployhub init --detect`
2. 출력된 `INFERRED FIELDS`와 `UNKNOWN FIELDS`를 검토하고 확인된 값만
   `deployhub.yaml`에 보완한다.
3. `deployhub validate`
4. `deployhub register --draft`
5. 출력된 Draft URL에서 사람이 검토하고 승인한다.

기존 프로젝트:

1. `deployhub status`
2. `deployhub diff`
3. 필요한 경우 `deployhub.yaml`을 수정한다.
4. `deployhub validate`
5. `deployhub sync --draft`
6. 출력된 Draft URL에서 사람이 변경 내용을 검토하고 승인한다.

YAML 구조를 임의로 추측하지 않는다. 반드시 CLI가 생성한 manifest와
`deployhub.yaml` 첫 줄의 최신 Schema를 사용하며, 검증에 실패한 manifest는
제출하지 않는다.

구성요소의 배포 선언:

- `provider`에는 실제로 사용하는 배포·인프라 제공자를 적는다. Schema가
  허용하는 provider만 사용하고, 알 수 없으면 임의로 추측하지 말고 생략한다.
- `externalRef`에는 Supabase project ref, Vercel project id처럼 제공자 안에서
  구성요소를 식별하는 확인된 외부 참조값만 적는다.
- `container`에는 운영 배포 설정에서 확인한 Docker 컨테이너 이름을 적는다.
  값은 영문자·숫자로 시작하고 이후에는 영문자·숫자·`_`·`.`·`-`만 허용한다.
- `url`에는 확인된 운영 HTTP(S) URL만 적는다. 파일에서 확인할 근거가 없으면
  그럴듯한 기본 URL을 만들지 않는다.
