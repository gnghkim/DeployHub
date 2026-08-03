# AI에게 DeployHub 프로젝트 등록 맡기기

이 문서는 **다른 프로젝트를 DeployHub에 등록하거나 등록 정보를 갱신하는 작업**을
AI에게 맡기는 방법을 설명합니다. 대상 프로젝트의 실제 서비스 배포는 다루지
않습니다. DeployHub 자체 서비스의 배포는 다루지 않습니다. AI는 검증된 내용을
Draft로 제출하고, 최종 반영은 사용자가 Draft 화면에서 검토·승인합니다.

## 이 매뉴얼의 범위

이 매뉴얼로 AI에게 맡길 수 있는 작업은 다음과 같습니다.

- 저장소를 조사해 신규 프로젝트 등록 초안 만들기
- 이미 등록된 프로젝트와 현재 저장소의 차이 확인하기
- 변경된 기술 구성과 운영 배포 정보를 Draft로 제출하기
- 검증 오류나 확인되지 않은 값의 원인 조사하기

다음 작업은 범위에 포함되지 않습니다.

- 대상 프로젝트의 코드 빌드 또는 실제 서비스 배포
- 서버 재시작, 데이터베이스 변경, 인프라 생성·삭제
- DeployHub 자체 서비스의 배포와 운영
- AI가 Draft를 최종 승인하는 작업

## 5분 빠른 시작

1. 등록할 프로젝트의 저장소를 AI 작업 공간으로 엽니다.
2. 터미널에 `DEPLOYHUB_URL`과 `DEPLOYHUB_TOKEN`을 환경변수로 준비합니다.
   토큰 값은 AI 대화에 붙여 넣지 않습니다.
3. 처음 등록하는 프로젝트라면 [신규 프로젝트 등록 요청문](#ai에게-보낼-요청문)을,
   이미 등록된 프로젝트라면 [정보 갱신 요청문](#ai에게-보낼-요청문-1)을 복사해
   AI에게 보냅니다.
4. AI가 조사·검증을 마치고 Draft URL을 보고할 때까지 기다립니다.
5. Draft 화면에서 변경 내용을 확인한 뒤 직접 승인하거나 반려합니다.

> 핵심 원칙: **AI는 Draft 제출까지만, 최종 승인은 사용자가 직접** 합니다.

## 시작 전에 준비할 것

### 필수 준비

- Node.js 22 이상
- AI가 읽을 수 있도록 연 등록 대상 프로젝트 저장소
- 관리자가 제공한 DeployHub 서버 URL
- 해당 프로젝트를 등록하거나 갱신할 수 있는 DeployHub 토큰

CLI를 별도로 설치할 필요는 없습니다. AI는 대상 저장소 루트에서
`npx @deployhub/cli`를 사용합니다.

### 터미널 환경변수 설정

`DEPLOYHUB_URL`은 공개 가능한 서버 주소지만, `DEPLOYHUB_TOKEN`은 비밀값입니다.
아래 예시처럼 토큰을 가려서 입력하면 대화나 명령 기록에 실제 값이 남는 일을 줄일
수 있습니다.

PowerShell 7:

```powershell
$env:DEPLOYHUB_URL = 'https://deployhub.example.com'
$deployHubTokenInput = Read-Host 'DEPLOYHUB_TOKEN' -MaskInput
Set-Item -Path Env:DEPLOYHUB_TOKEN -Value $deployHubTokenInput
Remove-Variable deployHubTokenInput
```

macOS 또는 Linux:

```bash
export DEPLOYHUB_URL='https://deployhub.example.com'
read -rsp 'DEPLOYHUB_TOKEN: ' DEPLOYHUB_TOKEN; echo
export DEPLOYHUB_TOKEN
```

`https://deployhub.example.com`은 관리자가 알려준 실제 DeployHub 주소로 바꿉니다.
토큰 자체는 이 문서, 저장소 파일, AI 대화 또는 명령 인자에 적지 않습니다.

### 대상 저장소에 AI 지침 추가하기

반복해서 등록 정보를 관리할 프로젝트라면
[다른 저장소용 AGENTS 템플릿](../templates/AGENTS.deployhub.md)의 내용을 대상
저장소의 `AGENTS.md`, `CLAUDE.md` 같은 기존 지침에 합쳐 두는 것을 권장합니다.
기존 지침 파일을 통째로 덮어쓰지 말고 DeployHub 관련 부분만 추가합니다.

## 신규 프로젝트 등록 맡기기

DeployHub에 아직 없는 프로젝트에 사용합니다. AI는 저장소를 감지해
`deployhub.yaml`을 만들고, 확인된 값만 보완한 뒤 신규 등록 Draft를 제출합니다.

### AI에게 보낼 요청문

```text
이 저장소의 실제 기술 구성과 운영 배포 설정을 조사해서 DeployHub 신규 등록을 준비해줘.

- 작업 범위는 DeployHub 프로젝트 등록까지야. 실제 서비스 배포는 하지 마.
- 저장소 루트에서 DeployHub CLI를 사용해 deployhub.yaml을 생성해.
- CLI가 출력한 INFERRED FIELDS와 UNKNOWN FIELDS를 검토하고, 파일에서 확인되는 값만 보완해.
- provider, externalRef, container, 운영 URL은 추측하지 마.
- 비밀값을 파일, 명령 인자, 로그 또는 대화에 출력하지 마.
- validate에 성공한 뒤 register --draft까지만 실행해.
- 최종 승인은 하지 말고 Draft URL, 확인된 내용, 확인하지 못한 내용을 보고해줘.
```

AI가 `UNKNOWN FIELDS`를 보고하면 그 값을 억지로 채우게 하지 마세요. 운영 담당자가
확인할 수 있는 근거를 제공하거나, 알 수 없는 선택 필드는 생략하도록 요청합니다.

## 기존 프로젝트 정보 갱신 맡기기

기술 스택, 구성요소, 운영 URL 또는 배포 환경이 바뀐 프로젝트에 사용합니다. AI는
서버에 등록된 정보와 로컬 manifest를 먼저 비교하고 필요한 변경만 Draft로
제출합니다.

### AI에게 보낼 요청문

```text
이 저장소의 현재 기술 구성과 운영 배포 설정을 조사해서 DeployHub 등록 정보와 비교해줘.

- 작업 범위는 DeployHub 정보 갱신까지야. 실제 서비스 배포는 하지 마.
- 먼저 status와 diff를 실행해 현재 상태와 차이를 확인해.
- 필요한 변경만 deployhub.yaml에 반영하고, 확인되지 않은 값은 추측하지 마.
- 비밀값을 파일, 명령 인자, 로그 또는 대화에 출력하지 마.
- validate에 성공한 뒤 sync --draft까지만 실행해.
- 최종 승인은 하지 말고 Draft URL, 변경 요약, 확인하지 못한 내용을 보고해줘.
```

차이가 없다면 AI는 빈 Draft를 만들 필요가 없습니다. `diff` 결과에 변경이 없다고
보고하고 종료하도록 합니다.

## AI가 따라야 하는 절차

모든 명령은 **등록 대상 저장소의 루트**에서 실행합니다.

### 신규 프로젝트

```text
npx @deployhub/cli init --detect
# INFERRED FIELDS와 UNKNOWN FIELDS를 검토하고 확인된 값만 deployhub.yaml에 보완
npx @deployhub/cli validate
npx @deployhub/cli register --draft
```

### 기존 프로젝트

```text
npx @deployhub/cli status
npx @deployhub/cli diff
# 필요한 경우 확인된 변경만 deployhub.yaml에 반영
npx @deployhub/cli validate
npx @deployhub/cli sync --draft
```

AI는 감지 또는 비교와 `validate` 사이에서 `deployhub.yaml`을 수정할 수 있습니다.
단, 저장소 파일이나 확인된 운영 설정에서 근거를 찾은 값만 사용해야 합니다.

| 명령 | `DEPLOYHUB_TOKEN` 필요 여부 |
| --- | --- |
| `init --detect`, `validate` | 불필요 |
| `status`, `diff` | 필요 |
| `register --draft`, `sync --draft` | 필요 |

`register`와 `sync`에는 항상 `--draft`를 사용합니다. CLI에는 AI가 최종 승인을
대신하는 명령이 없습니다.

## Draft에서 사용자가 확인할 것

AI가 전달한 Draft URL을 열고 다음 항목을 확인합니다.

- [ ] 프로젝트 이름과 slug가 대상 프로젝트와 일치하는가?
- [ ] 저장소 소유자와 저장소명이 정확한가?
- [ ] 프론트엔드, API, 데이터베이스, 워커 등 구성요소가 빠지거나 중복되지 않았는가?
- [ ] 각 구성요소의 `provider`가 실제 배포·인프라 제공자인가?
- [ ] `externalRef`가 실제 Provider 안에서 확인된 식별자인가?
- [ ] `container`가 운영 설정에서 사용하는 실제 컨테이너 이름인가?
- [ ] `url`이 실제 운영 HTTP(S) 주소인가?
- [ ] 예상하지 않은 삭제나 대규모 변경이 포함되지 않았는가?
- [ ] Draft 검증 결과가 성공인가?
- [ ] AI가 확인하지 못해 생략했다고 보고한 항목이 허용 가능한가?

하나라도 확실하지 않으면 승인하지 말고 Draft를 반려한 뒤 AI에게 근거를 다시
조사하도록 요청합니다.

## 비밀정보와 추측 방지 원칙

### 비밀정보

- `DEPLOYHUB_TOKEN`은 터미널 환경변수로만 전달합니다.
- 토큰, 사용자 비밀번호, Provider Secret을 AI 대화에 붙여 넣지 않습니다.
- 비밀값을 `deployhub.yaml`, `.env.example`, 문서 또는 소스 코드에 저장하지 않습니다.
- 비밀값을 CLI 명령 인자에 넣거나 로그로 출력하지 않습니다.
- AI의 완료 보고에 토큰 일부라도 포함되어 있으면 폐기하고 새 토큰을 발급받습니다.

### 추측하면 안 되는 값

- YAML 구조: CLI가 생성한 manifest와 첫 줄의 최신 Schema를 사용합니다.
- `provider`: 실제로 사용하는 제공자이며 Schema가 허용하는 값만 사용합니다.
- `externalRef`: Provider 화면이나 운영 설정에서 확인된 외부 식별자만 사용합니다.
- `container`: Docker 또는 운영 배포 설정에서 확인된 이름만 사용합니다.
- `url`: 실제 운영 HTTP(S) URL만 사용합니다.

근거를 찾지 못한 값은 만들지 말고 생략하거나 사용자 확인 필요 항목으로 보고합니다.
검증에 실패한 manifest는 Draft로 제출하지 않습니다.

## 문제가 생겼을 때 다시 요청하기

상세 오류 원인과 대응은
[프로젝트 등록 상세 가이드의 문제 해결](./project-registration.md#10-문제-해결)을
참고합니다.

### Draft를 제출하지 않고 검증만 하기

```text
현재 deployhub.yaml을 조사하고 validate까지만 실행해줘.
Draft는 제출하지 말고, 검증 오류와 확인되지 않은 필드만 정리해줘.
비밀값은 출력하지 마.
```

### 누락되거나 추측된 것으로 보이는 값 다시 조사하기

```text
deployhub.yaml의 provider, externalRef, container, url을 저장소와 운영 설정에서 다시 조사해줘.
각 값의 근거 파일이나 설정 위치를 함께 보고하고, 근거가 없는 값은 제거하거나 생략해.
이번에는 Draft를 제출하지 말고 수정안과 확인 필요 항목만 보고해줘.
```

### 검증 오류 진단하기

```text
DeployHub CLI validate 오류의 원인을 최신 Schema와 실제 저장소 설정을 기준으로 진단해줘.
YAML 구조나 값을 추측하지 말고, 오류를 바로잡은 뒤 validate를 다시 실행해.
검증에 성공해도 이번 요청에서는 Draft를 제출하지 마.
```

### 401, 403 또는 서버 연결 오류 진단하기

```text
DeployHub CLI의 401, 403 또는 서버 연결 오류를 진단해줘.
DEPLOYHUB_URL 설정, 네트워크 접근, 토큰 만료·권한·저장소 제한 여부를 비밀값을 출력하지 않고 확인해.
토큰을 대화나 명령 인자로 요구하지 말고, 오류 원인과 사용자가 해야 할 조치만 보고해.
연결 문제가 해결될 때까지 Draft를 다시 제출하지 마.
```

401은 토큰의 만료·폐기·소진 가능성을, 403은 저장소나 프로젝트 slug 제한 불일치
가능성을 먼저 확인합니다. 연결 오류는 `DEPLOYHUB_URL`, 네트워크와 서버 상태를
확인합니다. 토큰 값을 확인한다는 이유로 AI에게 보여주면 안 됩니다.

## AI의 완료 보고 예시

AI에게 다음 형식으로 결과를 보고하도록 요청하면 승인 여부를 판단하기 쉽습니다.

```text
결과: Draft 제출 완료
검증: 성공
Draft URL: https://deployhub.example.com/settings/drafts/확인할-Draft-ID

확인된 변경:
- API 구성요소의 실제 운영 URL 반영
- 저장소 설정에서 확인한 컨테이너 이름 반영

확인하지 못해 생략한 항목:
- 워커의 externalRef: 저장소와 운영 설정에서 근거를 찾지 못함

사용자 검토 항목:
- API URL이 실제 운영 주소인지
- 컨테이너 이름이 운영 환경과 일치하는지
- externalRef 생략을 허용할지
```

Draft를 제출하지 않았다면 `결과`에 그 사실과 이유를 적고, Draft URL을 만들어
쓰지 않도록 합니다. 검증 실패, 변경 없음, 토큰 또는 연결 문제도 명확히 구분해서
보고해야 합니다.

## 더 자세한 문서

- [프로젝트 등록 상세 가이드](./project-registration.md) — 토큰 발급, manifest 필드,
  Draft 동작과 오류별 상세 설명
- [다른 저장소용 AGENTS 템플릿](../templates/AGENTS.deployhub.md) — 대상 저장소에
  추가할 수 있는 AI 작업 지침
