# 프로젝트 스냅샷 설계

## 배경

DeployHub 프로젝트 목록은 운영 상태와 구성요소를 텍스트로 보여주지만, 실제 서비스 화면을
한눈에 식별할 수 있는 시각 정보가 없다. 프로젝트별 대표 화면을 자동 캡처하거나 사용자가
직접 올릴 수 있게 하고, 목록 카드에서 기존 정보와 함께 보여준다.

현재 운영 환경은 단일 Hostinger VPS, Docker Compose, PostgreSQL이다. 애플리케이션용 영구
파일 볼륨이나 외부 오브젝트 스토리지는 없고 web과 worker는 같은 런타임 이미지를 사용한다.
따라서 Chromium을 기존 이미지에 넣지 않고 캡처 책임을 별도 서비스로 격리한다.

## 목표

- 프로젝트마다 자동 캡처에 사용할 대표 URL을 명시적으로 지정한다.
- 새 배포 성공을 감지하면 공개 페이지의 데스크톱 첫 화면을 자동 갱신한다.
- 사용자가 직접 캡처한 로그인 후 메인 화면을 업로드할 수 있다.
- 수동 업로드는 사용자가 자동 캡처를 재개하기 전까지 자동 결과로 덮어쓰지 않는다.
- 목록 카드에서 정보는 왼쪽, 스냅샷은 오른쪽에 표시하고 접으면 이름만 남긴다.
- 현재 대표 이미지 한 장만 보관해 저장량과 운영 복잡도를 제한한다.

## 범위 밖

- 로그인 계정, 비밀번호, 쿠키 또는 브라우저 세션을 저장해 자동 로그인하는 기능
- 스냅샷 이력, 갤러리, 대표 이미지 선택 기능
- 전체 페이지 캡처 또는 모바일 화면 동시 캡처
- 외부 스크린샷 API나 별도 오브젝트 스토리지 도입
- 스냅샷 이미지의 외부 공개 URL 제공

## 선택한 접근법

별도 `snapshotter` 컨테이너가 Playwright/Chromium으로 캡처하고 worker가 결과를 받아
PostgreSQL에 저장한다.

- 캡처 런타임을 web/worker 공용 이미지에서 분리한다.
- `snapshotter`는 호스트 포트를 열지 않는다.
- worker와 `snapshotter`만 새 `snapshot` 네트워크를 공유한다.
- `snapshotter`는 PostgreSQL, `deployhub` 네트워크, `docker-api` 네트워크와 Docker 소켓에
  접근하지 않는다.
- worker가 캡처 요청과 결과 저장을 조정하며 기존 jobs 큐와 재시도 정책을 재사용한다.
- 이미지는 별도 1:1 테이블의 `bytea`로 보관한다. 프로젝트 수가 적고 현재 이미지 한 장만
  유지하므로 DB 백업에 함께 포함하는 편이 별도 스토리지 운영보다 단순하다.

## 데이터 모델

### `projects` 추가 필드

- `snapshot_url TEXT NULL`: 자동 캡처의 명시적 대표 URL
- `snapshot_mode`: `disabled | automatic | manual`
  - `disabled`: 표시할 기존 이미지는 유지할 수 있지만 자동 작업을 만들지 않는다.
  - `automatic`: 배포 성공과 즉시 캡처 요청을 처리한다.
  - `manual`: 수동 업로드로 고정된 상태이며 자동 결과를 받지 않는다.

신규 프로젝트의 기본 모드는 `disabled`다. `automatic`으로 바꾸려면 유효한
`snapshot_url`이 반드시 있어야 한다. 이 값은 운영 UI 환경설정이며 선언 manifest의 기술
구성 필드가 아니므로 `deployhub.yaml`에 추가하지 않는다.

### `project_snapshots` 1:1 테이블

- `project_id UUID PRIMARY KEY`, `projects.id` 참조, 프로젝트 삭제 시 cascade
- `image_data BYTEA NULL`
- `content_type TEXT NULL`, 저장 성공 시 항상 `image/webp`
- `width INTEGER NULL`, `height INTEGER NULL`
- `source`: `automatic | manual`, 성공 이미지가 없으면 NULL
- `source_url TEXT NULL`
- `deployment_id UUID NULL`, 자동 캡처를 유발한 배포 식별자
- `checksum TEXT NULL`, 이미지 ETag 생성용 SHA-256
- `captured_at TIMESTAMPTZ NULL`
- `last_attempt_at TIMESTAMPTZ NULL`
- `last_attempt_status`: `pending | success | failed`
- `last_error TEXT NULL`, 정규화된 짧은 오류 코드/메시지
- `updated_at TIMESTAMPTZ NOT NULL`

한 행은 현재 성공 이미지와 마지막 시도 상태를 함께 보관한다. 새 시도가 실패하면
`image_data`, 성공 메타데이터와 `captured_at`은 그대로 두고 시도 상태만 갱신한다. 첫 시도가
실패한 경우에는 이미지가 없는 상태 행이 존재할 수 있다.

## 자동 캡처 흐름

1. 배포 수집기가 새 운영 배포의 성공 상태를 처음 저장한다.
2. 프로젝트가 `automatic`이고 `snapshot_url`이 있으면 기존 `enqueueUnique`를 사용해
   `snapshot.capture` job을 등록한다. 중복 키는 프로젝트와 배포 ID 조합이다.
3. 사용자가 `지금 캡처`를 누르거나 자동 모드를 새로 활성화한 경우에도 같은 job을 등록한다.
   이때 중복 키는 프로젝트와 설정 버전/요청 ID 조합이다.
4. worker handler는 실행 직전에 프로젝트 모드와 대표 URL을 다시 읽는다. 자동 모드가
   아니면 성공적으로 no-op 처리한다.
5. worker가 내부 `snapshotter` API에 URL, 1440×900 viewport와 20초 제한을 전달한다.
6. `snapshotter`는 URL을 검증하고 새 비영구 브라우저 컨텍스트에서 페이지를 연다.
   쿠키나 저장 상태는 요청 간 재사용하지 않는다.
7. DOM 로드와 글꼴 준비 후 짧은 안정화 시간을 두고 첫 viewport를 WebP로 캡처한다.
8. worker는 저장 직전 트랜잭션에서 프로젝트가 여전히 `automatic`이고 요청 URL이 현재
   설정과 같은지 다시 비교한다. 수동 업로드나 설정 변경이 먼저 발생했으면 결과를 버린다.
9. 조건이 유지되면 현재 이미지 행을 upsert하고 목록·상세 캐시를 무효화한다.

동일 프로젝트의 pending/running 캡처는 하나만 허용한다. job은 최대 3회 재시도하되
영구적인 URL 검증 오류는 재시도하지 않는다.

## 수동 업로드 흐름

1. 프로젝트 상세 화면에서 사용자가 PNG, JPEG 또는 WebP 파일을 선택한다.
2. 인증된 multipart Route Handler가 최대 5MB, 허용 MIME과 실제 이미지 디코딩을 검증한다.
3. `sharp`로 EXIF 등 메타데이터를 제거하고 1440×900 안에 맞춘 WebP로 변환한다.
   원본 비율은 유지하며 남는 공간은 어두운 배경으로 채운다.
4. 변환 결과가 1.5MB를 넘으면 저장하지 않고 크기 오류를 반환한다.
5. 트랜잭션에서 현재 이미지를 교체하고 `snapshot_mode = manual`, `source = manual`로
   저장한다. 진행 중인 자동 job은 마지막 모드 확인에서 결과를 버린다.

`자동 캡처 재개`는 모드를 `automatic`으로 바꾸고 즉시 새 job을 등록한다. 성공 전까지는
기존 수동 이미지가 유지된다. `스냅샷 삭제`는 이미지와 성공 메타데이터만 제거하며 현재 모드는
바꾸지 않는다. 따라서 manual 모드에서 삭제하면 빈 수동 상태로 남고 자동 갱신되지 않는다.

## 캡처 서비스 계약과 보안

`snapshotter`는 내부 네트워크의 캡처 endpoint 하나만 제공하며 이미지 바이트와 최소 메타데이터만
반환한다. 요청·응답 크기를 제한하고 로그에는 URL query, 페이지 내용, 응답 본문을 남기지 않는다.

자동 캡처 URL에는 다음 정책을 적용한다.

- `http`와 `https`, 포트 80과 443만 허용
- URL 사용자정보 금지
- localhost, loopback, private, link-local, multicast, reserved, 클라우드 메타데이터 IP 차단
- IPv4와 IPv6를 모두 검사
- DNS의 모든 결과를 검사하고 연결 직전 다시 확인
- 최대 5회 리다이렉트, 각 목적지를 동일하게 재검증
- TLS 인증서 오류를 무시하지 않음
- 다운로드, 파일 URL, 브라우저 확장 protocol과 영구 저장소 사용 금지
- 전체 요청 제한 20초

worker에서도 형식 검사를 먼저 하지만 최종 SSRF 방어는 실제 네트워크 요청을 수행하는
`snapshotter`가 맡는다. 캡처 실패는 `timeout`, `blocked_target`, `navigation_failed`,
`render_failed`, `image_too_large` 등 정규화된 사유로만 DB와 로그에 남긴다.

이미지 조회 endpoint도 로그인 세션을 확인한다. 응답은 `Cache-Control: private`와 checksum 기반
ETag를 사용한다. 프로젝트 목록의 이미지는 `loading="lazy"`로 불러온다.

## 화면 설계

### 프로젝트 편집 화면

- 대표 스냅샷 URL
- 자동 캡처 사용 여부
- 자동 모드에서 URL이 없거나 URL 정책에 맞지 않으면 필드 오류 표시

### 프로젝트 상세 화면

- 현재 이미지와 출처(`자동 캡처` 또는 `수동 업로드`), 캡처 시각
- `지금 캡처`: automatic 모드에서 공개 대표 URL을 즉시 캡처
- `이미지 업로드`: 성공하면 manual 모드로 전환
- `자동 캡처 재개`: manual 모드에서 automatic으로 전환하고 즉시 캡처
- `스냅샷 삭제`: 현재 이미지 제거
- 마지막 실패가 있으면 기존 이미지를 유지한 채 짧은 오류와 시도 시각 표시

로그인 후 첫 메인 화면은 자동 인증하지 않고 사용자가 직접 캡처하여 업로드한다.

### 프로젝트 목록 카드

- 기존 헤더와 접기 동작을 유지한다.
- 펼친 본문은 데스크톱에서 정보 왼쪽, 스냅샷 오른쪽의 2열이다.
- 스냅샷 열은 약 42%, 정보 열은 나머지 공간을 사용한다.
- 모바일에서는 기존 정보 아래에 스냅샷을 배치한다.
- 접으면 정보와 스냅샷이 모두 숨겨져 프로젝트 이름만 보인다.
- 이미지를 누르면 인증된 원본 이미지 endpoint를 새 창에서 연다.
- 이미지가 없으면 `스냅샷 없음`과 상세 화면의 설정 링크를 표시한다.
- 캡처 중에는 기존 이미지를 유지하고 `갱신 중` 상태만 덧붙인다.

## 오류 처리와 동시성

- 자동 캡처 실패는 현재 성공 이미지를 삭제하지 않는다.
- 수동 업로드와 자동 결과 저장은 프로젝트 행 잠금/조건부 갱신으로 순서를 결정한다.
- 수동 업로드가 먼저 commit되면 늦은 자동 결과는 폐기한다.
- snapshotter 연결 실패와 일시적 navigation 실패는 jobs 재시도 정책을 따른다.
- 차단 URL, 잘못된 형식, 과대 이미지는 즉시 실패 처리한다.
- snapshotter가 중단돼도 web과 일반 worker job은 계속 동작한다.
- 이미지 blob은 프로젝트 목록의 기본 query에 포함하지 않고 별도 메타데이터 조회와 이미지
  endpoint로 분리한다.

## 테스트

### DB와 worker

- 마이그레이션과 1:1 cascade
- 현재 이미지/마지막 시도 상태 upsert
- 성공 배포의 unique job 생성과 중복 방지
- disabled/manual 모드 no-op
- 저장 직전 모드·URL 변경 감지
- 실패 시 기존 이미지 보존
- 수동 업로드와 자동 결과의 경합

### snapshotter

- 고정 fixture 페이지의 1440×900 WebP 생성
- timeout과 navigation 오류 정규화
- IPv4/IPv6 내부 주소 차단
- DNS 다중 응답과 redirect 재검증
- 허용하지 않는 protocol, 포트와 사용자정보 차단
- 20초 제한과 결과 크기 제한

### web

- 모든 변경 endpoint의 인증 검사
- PNG/JPEG/WebP 성공 및 MIME 위장, 손상 파일, 5MB 초과 실패
- 변환 결과의 크기, WebP 형식과 메타데이터 제거
- manual 전환, 자동 재개, 삭제 동작
- 이미지 endpoint의 private cache와 ETag
- 카드의 데스크톱 2열, 모바일 순서, lazy loading과 접기 상태
- 상세 화면의 모드별 action 노출과 오류 표시

### 통합과 배포

- 전체 테스트, 타입 검사, web/worker/snapshotter 프로덕션 빌드
- `docker compose config`와 snapshot 전용 네트워크/호스트 포트 부재 확인
- 운영 마이그레이션 후 새 컨테이너 기동
- 공개 fixture URL 자동 캡처와 수동 업로드 end-to-end 확인
- 기존 health, worker와 PostgreSQL 상태 회귀 확인

## DeployHub 등록과 배포

`snapshotter`는 실제 운영 구성요소이므로 구현 후 저장소 루트의 지침을 따른다.

1. CLI를 `pnpm --filter @deployhub/cli build`로 빌드한다.
2. 기존 프로젝트 절차의 `status`, `diff`, 로컬 `validate`를 실행한다.
3. 최신 Schema가 허용하는 값만 사용해 `deployhub.yaml`에 snapshotter 구성요소를 추가한다.
   확인된 컨테이너 이름은 `deployhub-snapshotter`를 사용하고 provider/type은 CLI Schema가 허용하는
   확인된 값만 기록한다.
4. `sync --draft`로 제출하고 Draft URL에서 사람이 검토·승인한다.
5. 운영에서는 DB 마이그레이션, 이미지 빌드, Compose 재기동, 자동/수동 캡처 검증 순서로 배포한다.

토큰, 로그인 정보, Provider Secret은 manifest, 명령 인자, 로그 또는 대화에 기록하지 않는다.

## 완료 기준

- 프로젝트별 대표 URL과 모드를 저장하고 편집할 수 있다.
- 새 성공 배포가 automatic 프로젝트의 현재 스냅샷을 갱신한다.
- 수동 업로드가 로그인 후 화면을 등록하고 자동 덮어쓰기를 중지한다.
- 자동 재개 후 성공할 때까지 기존 수동 이미지가 유지된다.
- 목록 카드가 확정된 좌측 정보/우측 이미지 배치와 접기 동작을 제공한다.
- 캡처 실패와 snapshotter 중단이 기존 이미지와 다른 DeployHub 기능에 영향을 주지 않는다.
- SSRF, 업로드 위장, 크기 제한과 인증 경계 테스트가 통과한다.
- 운영 구성과 DeployHub Draft가 실제 snapshotter 구성요소를 반영한다.
