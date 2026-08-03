# Self-contained DeployHub manual prompts design

## 배경

DeployHub 사용 매뉴얼의 복사 요청문은 AI에게 `DeployHub CLI`를 사용하라고만
지시한다. 요청문만 복사한 경우 AI가 PATH에서 `deployhub` 명령을 찾거나 공식
사용법을 웹에서 검색할 수 있다. 다른 프로젝트 저장소에서는 전역 명령 대신 공개
npm 패키지인 `npx @deployhub/cli`를 바로 사용해야 한다.

## 목표

- 신규 등록과 기존 정보 갱신 요청문을 각각 독립적으로 실행 가능한 지침으로 만든다.
- AI가 웹 검색이나 CLI 전역 설치로 우회하지 않도록 명시한다.
- 저장소의 기존 작업과 비밀값을 보호한다.
- 검증에 성공한 Draft를 한 번만 제출하고 최종 승인은 사용자에게 남긴다.
- 인앱 매뉴얼과 Markdown 원본의 내용을 동일하게 유지한다.

## 범위

다음 두 복사 요청문만 보강한다.

1. 신규 프로젝트 등록 맡기기
2. 기존 프로젝트 정보 갱신 맡기기

페이지 레이아웃, 복사 버튼 동작, CLI 구현, DeployHub API, 배포 구성은 변경하지
않는다.

## 요청문 설계

두 요청문 모두 다음 공통 규칙을 포함한다.

- 전역 `deployhub` 명령을 찾거나 CLI 사용법을 웹에서 검색하지 않는다.
- CLI를 전역 설치하지 않는다.
- 등록 대상 저장소 루트에서 `npx @deployhub/cli`를 사용한다.
- `DEPLOYHUB_URL`과 `DEPLOYHUB_TOKEN`은 현재 터미널 환경변수만 사용하며 값을
  출력하지 않는다.
- 등록과 무관한 기존 작업 파일은 수정하거나 커밋하지 않는다.
- 확인되지 않은 provider, externalRef, container, 운영 URL은 추측하지 않는다.
- 검증 성공 후 Draft 제출 명령은 한 번만 실행한다.
- 최종 승인은 하지 않고 Draft URL과 확인·미확인 내용을 보고한다.

신규 등록 요청문에는 아래 순서를 직접 넣는다.

```text
npx @deployhub/cli init --detect
npx @deployhub/cli validate
npx @deployhub/cli register --draft
```

기존 정보 갱신 요청문에는 아래 순서를 직접 넣는다.

```text
npx @deployhub/cli status
npx @deployhub/cli diff
npx @deployhub/cli validate
npx @deployhub/cli sync --draft
```

AI는 탐지 또는 비교 뒤, 저장소와 확인된 운영 설정에 근거한 값만
`deployhub.yaml`에 반영한다. 기존 프로젝트에서 차이가 없으면 Draft를 만들지 않고
종료한다.

## 콘텐츠 동기화

같은 요청문을 다음 두 위치에서 함께 수정한다.

- `apps/web/src/app/manual/page.tsx`
- `docs/ai-project-registration-manual.md`

인앱 페이지가 복사 버튼에 전달하는 문자열과 Markdown의 fenced text 블록은 동일한
실행 의미를 가져야 한다.

## 오류 및 안전 처리

- `npx` 실행이나 환경변수 확인에 실패하면 AI는 웹 검색이나 전역 설치를 시도하지
  않고 필요한 사용자 조치를 보고한다.
- `validate`가 실패하면 Draft 제출을 중단한다.
- 제출 결과가 불확실하거나 제출 명령이 실패하면 자동 재시도하지 않는다. 토큰의
  중복 소모를 막기 위해 상태와 오류만 보고한다.
- 비밀값은 파일, 명령 인자, 로그, 대화에 기록하지 않는다.

## 테스트

기존 정적 콘텐츠 테스트를 보강해 인앱 페이지와 Markdown 문서 모두에서 다음을
확인한다.

- 신규·기존 요청문에 각자의 전체 `npx @deployhub/cli` 명령 순서가 있다.
- 웹 검색과 전역 설치를 금지한다.
- 환경변수 값 출력과 기존 작업 수정을 금지한다.
- Draft 제출은 검증 후 한 번만 실행하도록 지시한다.

복사 버튼의 상태 관리와 페이지 레이아웃은 변경하지 않으므로 기존 테스트를 회귀
검증으로 그대로 실행한다.
