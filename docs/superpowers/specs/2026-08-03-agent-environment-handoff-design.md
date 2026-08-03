# Agent environment handoff manual design

## 배경

현재 매뉴얼은 사용자가 PowerShell에서 `$env:DEPLOYHUB_URL`과
`$env:DEPLOYHUB_TOKEN`을 설정하도록 안내한다. 이 값은 해당 PowerShell
프로세스와 그 자식 프로세스에만 전달된다. 이미 실행 중인 Orca/AI는 별도
프로세스이므로 나중에 설정한 값을 자동으로 받지 못한다.

사용자가 User 범위 환경변수까지 저장해도 이미 실행 중인 AI 프로세스의 환경은
갱신되지 않는다. 이 차이를 설명하지 않으면 사용자는 토큰을 다시 출력하거나
대화·스크린샷에 노출하면서 문제를 해결하려 할 수 있다.

## 목표

- 환경변수가 프로세스 시작 시 상속된다는 점을 명확히 설명한다.
- PowerShell에서 토큰 입력을 화면과 명령 기록에 노출하지 않는다.
- 신규 Orca/AI 세션과 이미 실행 중인 세션에 각각 동작하는 절차를 제공한다.
- 토큰 값, 길이, 접두사와 일부 문자열을 출력하지 않고 존재 여부만 확인한다.
- User 범위에 저장한 토큰을 작업 후 제거하도록 안내한다.
- 토큰이 화면, 로그, 대화 또는 캡처에 노출되면 즉시 폐기하도록 안내한다.

## 범위

다음 콘텐츠만 변경한다.

- 인앱 매뉴얼의 `5분 빠른 시작`, `시작 전에 준비할 것`, `문제가 생겼을 때`
- `docs/ai-project-registration-manual.md`의 대응 섹션
- 인앱 매뉴얼의 환경변수 복구용 복사 요청문
- 두 문서의 동기화를 검증하는 정적 콘텐츠 테스트

CLI, 인증, 토큰 저장 방식, API, 데이터베이스와 배포 구성은 변경하지 않는다.

## 기본 절차

### PowerShell User 범위 설정

Windows에서 Orca/AI가 새로 시작될 때 값을 상속받도록 URL과 토큰을 User 범위에
저장한다. 토큰은 `Read-Host -AsSecureString`으로 입력하고, 환경변수 저장에 필요한
순간에만 평문 문자열로 변환한 뒤 즉시 지역 변수를 제거한다.

```powershell
[Environment]::SetEnvironmentVariable(
  'DEPLOYHUB_URL',
  'https://deployhub.example.com',
  'User'
)

$secureToken = Read-Host 'DEPLOYHUB_TOKEN' -AsSecureString
$plainToken = [Net.NetworkCredential]::new('', $secureToken).Password
[Environment]::SetEnvironmentVariable('DEPLOYHUB_TOKEN', $plainToken, 'User')
Remove-Variable secureToken, plainToken
```

User 범위 환경변수는 사용자 계정으로 실행되는 다른 프로세스에서도 읽을 수 있는
지속 설정이다. 토큰을 영구 보관하는 기능으로 설명하지 않고, 등록 작업을 위한
일시적인 전달 수단으로 설명한다.

### 프로세스 재시작

환경변수를 저장한 뒤 이미 실행 중인 Orca/AI 창과 프로세스를 완전히 종료하고 새로
시작한다. 채팅만 계속하거나 새 터미널 탭만 여는 것으로 충분하다고 안내하지 않는다.
새 AI 세션은 등록 대상 저장소에서 시작한다.

### 안전한 존재 확인

새 세션에서는 값, 길이, 접두사 또는 일부 문자열을 출력하지 않고 Boolean만
확인한다.

```powershell
$urlPresent = -not [string]::IsNullOrWhiteSpace($env:DEPLOYHUB_URL)
$tokenPresent = -not [string]::IsNullOrWhiteSpace($env:DEPLOYHUB_TOKEN)
"DEPLOYHUB_URL_PRESENT=$urlPresent"
"DEPLOYHUB_TOKEN_PRESENT=$tokenPresent"
```

둘 중 하나라도 `False`면 CLI 제출 명령을 실행하지 않는다.

### 작업 후 제거

Draft 제출 결과를 확인한 뒤 User 범위 토큰을 제거하고 AI 프로세스를 종료한다.

```powershell
[Environment]::SetEnvironmentVariable('DEPLOYHUB_TOKEN', $null, 'User')
Remove-Item Env:DEPLOYHUB_TOKEN -ErrorAction SilentlyContinue
```

이미 실행 중인 다른 프로세스에는 상속된 토큰이 남아 있을 수 있으므로 등록에 사용한
AI/터미널 프로세스도 종료한다.

## 기존 AI 세션 복구

재시작하지 않고 기존 AI 세션을 계속 사용하는 사용자를 위해 별도 복사 요청문을
제공한다. 요청문은 AI가 다음 규칙을 따르도록 한다.

- 현재 프로세스의 URL 또는 토큰이 비어 있을 때만 PowerShell User 범위에서 읽는다.
- 각 `npx @deployhub/cli` 명령을 실행하는 동일한 PowerShell 호출 안에서 `$env:`로
  복사한다. 다음 도구 호출까지 값이 유지된다고 가정하지 않는다.
- 값, 길이, 접두사와 일부 문자열을 출력하지 않고 존재 여부만 Boolean으로 보고한다.
- User 범위에도 값이 없으면 필요한 사용자 조치만 보고하고 CLI를 실행하지 않는다.
- Draft 제출에 실패했거나 결과가 불확실하면 자동으로 재시도하지 않는다.

이 요청문은 토큰 자체를 포함하지 않으며, AI에게 토큰을 대화로 요구하지 말라고
명시한다.

## 토큰 노출 사고 처리

토큰 전체나 일부가 터미널 출력, AI 대화, 로그, 스크린샷 또는 화면 공유에 나타나면
가리거나 다시 저장하는 것으로 끝내지 않는다. 해당 토큰을 즉시 폐기하고 새 토큰을
발급한다. 노출된 토큰은 다시 사용하지 않는다.

## 콘텐츠 배치

- `5분 빠른 시작`: 환경변수 저장 뒤 Orca/AI를 재시작한다는 단계를 명시한다.
- `시작 전에 준비할 것`: PowerShell 기본 절차, 안전한 확인, 작업 후 제거를 넣는다.
- `문제가 생겼을 때`: `환경변수가 AI 세션에서 보이지 않을 때` 소제목과 복사 요청문을
  추가한다.
- `비밀정보와 추측 방지 원칙`: 노출 시 즉시 폐기 및 재발급 규칙을 강화한다.

인앱 페이지와 Markdown 문서는 같은 명령과 안전 규칙을 제공한다.

## 테스트

기존 `apps/web/src/app/manual/page.test.ts`를 확장해 인앱 페이지와 Markdown 모두에서
다음을 검증한다.

- User 범위 설정과 `Read-Host -AsSecureString`
- 이미 실행 중인 Orca/AI 완전 재시작 안내
- `DEPLOYHUB_URL_PRESENT`과 `DEPLOYHUB_TOKEN_PRESENT` Boolean 확인
- 토큰 값·길이·일부 문자열 출력 금지
- 기존 세션 복구 요청문과 동일 PowerShell 호출 규칙
- User 범위 토큰 제거 명령
- 노출된 토큰 즉시 폐기·재발급 안내

복사 버튼과 페이지 레이아웃은 변경하지 않으므로 기존 회귀 테스트도 함께 실행한다.
