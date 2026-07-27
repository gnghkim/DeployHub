# DeployHub 화면 재설계 Implementation Plan

> **For agentic workers:** orca orchestration으로 codex 워커에게 카드 단위 위임된다. 각 Task는 격리 worktree에서 수행하고, 검증 명령이 모두 통과한 뒤 Claude의 설계 부합 검토를 거쳐 main에 병합한다.

**Goal:** 원본 계획서 16.3·16.4로 돌아간다 — **각 프로젝트가 무엇 위에서 어떻게 구성되어 돌고 있는지**를 한 줄과 한 화면으로 답한다.

**Architecture:** 화면을 세 층으로 나눈다. 매일 보는 것(프로젝트 목록·상세), 가끔 보는 것(발견), 설정할 때만 보는 것(자원·Provider·초안·토큰). 지금은 셋이 같은 높이에 있다.

**Tech Stack:** 기존 스택. 새 의존성 없음. 데이터는 M2까지 만든 것으로 전부 충당된다 — **새 수집기도 새 테이블도 필요 없다.**

**선행 문서:** 원본 계획서 §16.1~16.6, `DESIGN-raycast.md`, M2 계획서

---

## 왜 고치는가

사용자의 말: *"너무 정보가 많고 뭘 봐야 할지 모르겠어. 내가 보고 싶은 건 내가 지금 어떤 프로젝트들을 돌리고 있고, 그 프로젝트가 어떤 기반 위에 어떻게 구성되어 있는지야."*

원본 16.3은 그 질문에 한 줄로 답하도록 설계돼 있었다.

```
| 프로젝트   | 구성             | 배포          | DB         | 상태 | 최근 배포 |
| LinkVault | Next.js + Worker | Vercel + VPS | Supabase   | 정상 | 12분 전  |
```

**구현은 이 표를 만들었지만 세 열을 채우지 않았다.** 현재 열은 `프로젝트 / 구성 / 상태 / Lifecycle / 저장소 / 최근 변경`이고, **`구성` 열은 항상 `—`다.** 한 번도 값이 들어간 적이 없다. `배포`와 `DB` 열은 아예 없고 그 자리에 `Lifecycle`·`저장소`가 들어갔다 — 둘 다 관리용 메타데이터지 "무엇 위에서 도는가"에 대한 답이 아니다.

Overview는 더 멀다. 숫자 카드 다섯(`전체 프로젝트`·`수집 저장소`·`실행 중 컨테이너`·`미연결 자원`·`Drift 있는 프로젝트`)과 `Signed in as` 카드뿐이고 **정작 프로젝트가 없다.** 원본 16.2의 중앙 영역 첫 항목이 "프로젝트 상태 목록"인데 빠졌다.

프로젝트 상세는 **맨 위가 편집 폼**이다. 그 아래 `뒷단`·`구성요소`·`연결된 자원` 세 섹션이 같은 것을 세 번 설명한다.

---

## 등록 방식은 바꾸지 않는다

**각 프로젝트를 코딩하는 AI가 `deployhub.yaml`을 만들어 CLI로 올리고 사람이 승인한다.** M1c와 M2에서 만든 그대로다.

화면이 관측만으로 프로젝트를 만들어내지 않는다. 자동 발견은 **별도 화면에서 "이런 것이 돌고 있다"고 알려주는 데까지**이고, 등록은 여전히 AI와 사람의 명시적 행위다.

이 구분이 흐려지면 카탈로그가 신뢰를 잃는다. 관측은 사실을 말하고 선언은 의도를 말한다 — M2 내내 지킨 구분이다.

---

## Global Constraints

M1·M2의 Global Constraints를 승계하고 아래를 더한다.

- **한 화면은 한 질문에 답한다.** 답이 아닌 것은 빼거나 아래 층으로 내린다.
- **숫자만 있는 카드를 만들지 않는다.** 보고 나서 할 일이 없으면 그 숫자는 화면을 차지할 자격이 없다. 숫자를 쓰려면 눌러서 갈 곳이 있어야 한다.
- **요약은 관측에서 도출한다.** 선언만 있고 관측이 없으면 `미확인 (선언: …)`이다. M2 Task 6에서 정한 규칙 그대로다.
- **새 테이블·새 마이그레이션 없음.** 이 재설계는 이미 있는 데이터를 다르게 보여줄 뿐이다.
- **요약 로직은 순수 함수로 분리하고 테스트한다.** 컴포넌트 안에 계산을 묻지 마라.
- 색은 `DESIGN-raycast.md`의 토큰만 쓴다. 새 색을 만들지 마라.

---

## Task 1: 프로젝트 한 줄 요약

원본 16.3의 세 열(`구성`·`배포`·`DB`)을 채운다. 이 카드가 나머지의 토대다.

**Files:**
- Create: `apps/web/src/lib/project-summary.ts`, `project-summary.test.ts`
- Modify: `apps/web/src/app/projects/page.tsx`
- Modify: `packages/db/src/queries/projects.ts` (목록 조회에 구성요소·자원 포함)

**Interfaces:**

```ts
export type ProjectSummaryInput = {
  components: Array<{
    type: string;              // frontend, worker, database, ...
    framework: string | null;  // nextjs, ...
    runtime: string | null;    // nodejs, postgresql, ...
    provider: string | null;   // 선언
  }>;
  observedProviders: string[]; // 관측 (docker, vercel, ...)
};

export type ProjectSummary = {
  stack: string;      // "Next.js + Worker"
  deployment: string; // "VPS Docker" / "Vercel + VPS" / "미확인 (선언: hostinger)"
  database: string;   // "PostgreSQL" / "Supabase" / "—"
};

export function summarizeProject(input: ProjectSummaryInput): ProjectSummary;
```

- [ ] **Step 1: 실패하는 테스트 작성**

`stack` — 구성요소의 framework와 type에서 만든다. **database 타입은 빼라.** 그것은 `database` 열의 몫이다.

```
[{type:'frontend',framework:'nextjs'}, {type:'worker'}]        → 'Next.js + Worker'
[{type:'frontend',framework:'nextjs'}]                          → 'Next.js'
[{type:'frontend',framework:'nextjs'}, {type:'api',runtime:'python'}] → 'Next.js + Python'
[]                                                              → '—'
```

framework 표시 이름은 매핑 표를 둔다: `nextjs → Next.js`, `react → React`, `fastapi → FastAPI`, `express → Express`. **매핑에 없으면 원문 그대로 쓴다.** 임의로 대문자화하지 마라 — `nuxtjs`를 `Nuxtjs`로 쓰면 틀린 이름이 된다.

`deployment` — **관측된 provider에서 만든다.** M2 Task 6의 `summarizeBackend`와 같은 규칙이다.

```
관측 {docker}          → 'VPS Docker'
관측 {vercel}          → 'Vercel'
관측 {docker, vercel}  → 'Vercel + VPS'
관측 {} + 선언 hostinger → '미확인 (선언: hostinger)'
관측 {} + 선언 없음     → '미확인'
```

`database` — `type === 'database'`인 구성요소에서 만든다. 선언 `provider`가 있으면 그것을(`supabase → Supabase`), 없으면 `runtime`을(`postgresql → PostgreSQL`). 둘 다 없으면 `—`.

검증할 것:
1. 위 표의 모든 경우
2. **database 구성요소가 `stack`에 들어가지 않는다**
3. 같은 framework가 둘이면 한 번만 나온다 (`Next.js + Next.js` 금지)
4. 순서가 안정적이다 — 구성요소 순서가 바뀌어도 같은 문자열
5. 관측이 있으면 선언이 `deployment`를 덮지 못한다

4번이 중요하다. 정렬하지 않으면 조회 순서가 바뀔 때마다 문자열이 달라져 눈에 거슬린다.

- [ ] **Step 2: 실패 확인 → 구현**

- [ ] **Step 3: 목록 화면 열 교체**

| 지금 | 바꾼 뒤 |
|---|---|
| 프로젝트 / 구성(빈칸) / 상태 / Lifecycle / 저장소 / 최근 변경 | 프로젝트 / 구성 / 배포 / DB / 최근 배포 |

`Lifecycle`과 `저장소`는 **상세 화면으로 옮긴다.** 목록에서 지운다.

`상태` 열은 **이번에 넣지 않는다.** 판정은 M3의 일이고 아직 없다. **없는 것을 있는 척 표시하지 마라** — 전부 `정상`으로 채우면 거짓말이 된다.

`최근 배포`는 `deployments` 테이블에서 가장 최근 것이다. `projects.updated_at`(= 레코드 수정 시각)을 쓰지 마라. 그것은 배포가 아니다.

- [ ] **Step 4: 검증과 커밋**

Run: `pnpm typecheck && pnpm test && pnpm --filter web build`

**게이트 통과 조건:** `구성` 열이 실제 값을 가질 것. `배포`가 관측에서 나올 것. 없는 `상태`를 지어내지 않을 것.

---

## Task 2: Overview를 프로젝트 목록으로

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/web/src/components/shell/sidebar.tsx` (또는 nav 파일)

- [ ] **Step 1: 숫자 카드와 로그인 카드 제거**

없앨 것:

```
전체 프로젝트 / 수집 저장소 / 실행 중 컨테이너 / 미연결 자원 / Drift 있는 프로젝트
Signed in as ...
```

`Signed in as`는 이미 상단바에 있다. 두 번 보여줄 이유가 없다.

나머지 넷은 **눌러서 갈 곳이 없는 숫자**다. `미연결 자원 50`을 보고 사용자가 할 수 있는 일이 없다. 정말 필요하면 각 화면의 제목 옆에 두면 된다 — 자원 화면에 `자원 54`, 발견 화면에 `발견 7`처럼.

- [ ] **Step 2: Overview = Task 1의 목록**

Overview와 Projects가 같은 것을 보여주게 된다. **그러면 하나로 합친다.** `/`가 프로젝트 목록이고 `/projects`는 거기로 리다이렉트한다.

상단에 한 줄만 둔다: `프로젝트 N`. 프로젝트가 없으면 비어 있다는 사실과 **등록하는 법**을 적는다.

```
아직 등록된 프로젝트가 없습니다.

각 프로젝트의 AI에게 "DeployHub에 등록해줘"라고 하면
deployhub.yaml을 만들어 올립니다.
```

**빈 화면에 "데이터 없음"만 쓰지 마라.** 다음에 무엇을 해야 하는지가 있어야 한다.

- [ ] **Step 3: 검증과 커밋**

**게이트 통과 조건:** 숫자만 있는 카드가 남지 않을 것. 빈 상태에 다음 행동이 있을 것.

---

## Task 3: 프로젝트 상세 — 구성도 하나로

**Files:**
- Create: `apps/web/src/app/projects/[slug]/composition.tsx`, `composition.test.ts`
- Modify: `apps/web/src/app/projects/[slug]/page.tsx`

- [ ] **Step 1: 세 섹션을 하나로 합친다**

지금 `뒷단`·`구성요소`·`연결된 자원`이 따로 있다. 셋 다 "이 프로젝트가 무엇으로 이뤄져 있는가"를 말한다. **하나의 구성도로 합친다.**

원본 16.4의 Architecture 그림을 텍스트로 만든다. **React Flow를 쓰지 마라** — 새 의존성이고, 이 정도 구조에는 과하다.

```
GitHub  gnghkim/DeployHub
   │
   ▼
VPS Docker  (hostinger)
   ├─ web        Next.js      deployhub-web        running
   ├─ worker     Node         deployhub-worker     running
   └─ database   PostgreSQL   deployhub-postgres   running
   │
   ▼
hub.nolzza.net
```

각 줄은 **선언(구성요소 이름·기술)과 관측(컨테이너 이름·상태)을 나란히** 둔다. M2 Task 6에서 정한 규칙이다 — 둘을 섞지 마라.

관측이 없는 구성요소는 컨테이너 자리를 비우고 `관측되지 않음`이라 쓴다. 선언으로 빈칸을 메우지 마라.

- [ ] **Step 2: 편집 폼을 뒤로 보낸다**

`ProjectForm`이 화면 맨 위에 펼쳐져 있다. **보러 온 사람에게 먼저 보이는 것이 입력란이면 안 된다.**

`편집` 버튼을 두고 눌렀을 때 폼이 나오게 한다. 별도 라우트(`/projects/[slug]/edit`)로 빼도 좋다 — 둘 중 어느 쪽이든 **기본 화면에서 폼이 보이지 않으면 된다.**

- [ ] **Step 3: 남길 것과 옮길 것**

| 섹션 | 처리 |
|---|---|
| 구성도 (합친 것) | 화면의 중심 |
| 최종 배포 | 구성도 아래 |
| Drift | 있을 때만 표시. 없으면 `Drift 없음` 한 줄 |
| Lifecycle·중요도·담당자·저장소 | 구성도 위 한 줄로 압축 |
| 편집 폼 | 버튼 뒤로 |

- [ ] **Step 4: 검증과 커밋**

**게이트 통과 조건:** 기본 화면에 입력란이 없을 것. 선언과 관측이 구분될 것. 관측 없는 구성요소를 선언으로 채우지 않을 것.

---

## Task 4: 발견 화면

관측됐지만 등록되지 않은 스택을 보여준다. **등록을 대신 하지는 않는다.**

**Files:**
- Create: `apps/web/src/app/discovered/page.tsx`, `page.test.ts`
- Create: `packages/db/src/queries/discovered.ts`, `discovered.test.ts`

- [ ] **Step 1: 조회**

`docker_container` 자원 중 **어떤 구성요소에도 연결되지 않은 것**을 `metadata.composeProject`로 묶는다.

```ts
export type DiscoveredStack = {
  stack: string;              // composeProject. 없으면 '(그룹 없음)'
  containers: Array<{
    name: string;
    image: string | null;
    status: string | null;
  }>;
};

export function listDiscoveredStacks(db: Db): Promise<DiscoveredStack[]>;
```

**이미 연결된 컨테이너가 하나라도 있는 스택은 제외한다.** 그 스택은 이미 등록된 프로젝트에 속한다.

`github_repository`는 여기 넣지 마라. 저장소는 실행 중인 것이 아니다.

- [ ] **Step 2: 화면**

```
발견됨  7                     관측됐지만 아직 등록되지 않은 스택입니다

workwiki                                              컨테이너 2
  workwiki-backend    running    workwiki-backend:latest
  workwiki-postgres   running    postgres:16-alpine

yield                                                 컨테이너 2
  yield-api-1         running    yield-api:latest
  yield-postgres-1    running    postgres:16-alpine
```

각 스택 아래에 **등록하는 법**을 한 번 적는다. 화면 상단에 한 번이면 충분하다.

```
등록하려면 해당 프로젝트를 작업 중인 AI에게 "DeployHub에 등록해줘"라고 하세요.
AI가 deployhub.yaml을 만들어 올리면 초안 화면에서 승인합니다.
```

**"등록" 버튼을 만들지 마라.** 화면이 관측만으로 프로젝트를 만들면 선언과 관측의 구분이 무너진다. 이 화면의 역할은 알려주는 것까지다.

발견된 것이 없으면 `모든 실행 중인 스택이 등록되어 있습니다`라고 쓴다. 좋은 상태이므로 그렇게 읽히게 한다.

- [ ] **Step 3: 검증과 커밋**

**게이트 통과 조건:** 등록 버튼이 없을 것. 이미 연결된 스택이 목록에 없을 것. 저장소가 섞이지 않을 것.

---

## Task 5: 네비게이션 정리

**Files:**
- Modify: `apps/web/src/components/shell/sidebar.tsx`
- Create: `apps/web/src/app/settings/page.tsx`
- Modify: 이동하는 화면들의 경로

- [ ] **Step 1: 세 층으로 나눈다**

지금은 여섯이 한 높이에 있다.

```
Overview / Projects / Providers / Resources / Drafts / Registration tokens
```

바꾼 뒤:

```
프로젝트          /            매일 본다
발견             /discovered   가끔 본다
설정             /settings     설정할 때만
  ├─ 자원        /settings/resources
  ├─ Provider    /settings/providers
  ├─ 등록 초안    /settings/drafts
  └─ 등록 토큰    /settings/tokens
```

`Overview`와 `Projects`는 Task 2에서 하나가 됐다.

**초안(`drafts`)에 대기 중인 항목이 있으면 설정 옆에 개수를 표시한다.** 승인을 기다리는 것이라 묻히면 안 된다. 그것 말고는 배지를 달지 마라.

- [ ] **Step 2: 기존 경로 유지**

`/resources`·`/providers`·`/drafts`로 오는 링크가 이미 있다. **깨뜨리지 말고 새 경로로 리다이렉트한다.** CLI 안내문이나 문서에 적힌 경로도 있다.

- [ ] **Step 3: 검증과 커밋**

Run: `pnpm typecheck && pnpm test && pnpm --filter web build`

앱을 띄우고 각 경로가 응답하는지 직접 확인한다. **빌드 통과는 라우팅이 맞다는 뜻이 아니다** — M1b 배포에서 미들웨어 matcher 오류가 빌드를 통과하고도 모든 요청을 500으로 만든 적이 있다.

**게이트 통과 조건:** 상단 항목이 셋일 것. 기존 경로가 살아 있을 것. 실제로 띄워서 확인할 것.

---

## Self-Review

**1. 원본 계획서 커버리지**

| 항목 | Task |
|---|---|
| 16.3 프로젝트 목록 (구성·배포·DB) | 1 |
| 16.2 중앙 영역 "프로젝트 상태 목록" | 2 |
| 16.4 프로젝트 상세 Architecture | 3 |
| 16.6 Unlinked 표시 | 4 |
| 16.1 좌측 Navigation | 5 |
| 16.2 Summary Card | **뺀다** — 눌러서 갈 곳 없는 숫자다. 상태 판정이 생기는 M3에서 다시 본다 |
| 16.4 React Flow 아키텍처 그래프 | **안 쓴다** — 텍스트 트리로 충분하고 새 의존성이 없다 |
| 16.3 검색·필터 | **뺀다** — 프로젝트가 한 자리 수인 동안은 필요 없다 |
| 16.5 Infrastructure (VPS 목록) | **M4** — Hostinger Collector가 있어야 채운다 |

**2. 타입 일관성**

- `ProjectSummary` — Task 1 정의, Task 2가 소비 ✓
- `summarizeBackend` — M2 Task 6 정의. Task 1의 `deployment`가 같은 규칙을 따른다 ✓
- `DiscoveredStack` — Task 4 정의, Task 4만 사용 ✓
- `computeDrift` — M2 Task 5 정의, Task 3이 소비 ✓

**3. 위험 지점**

- **없는 것을 있는 척 하기.** `상태` 열은 M3 전까지 넣지 않는다. 전부 `정상`으로 채우면 화면 전체의 신뢰가 무너진다.
- **선언으로 빈칸 메우기.** 관측 없는 구성요소는 비워 두고 `관측되지 않음`이라 쓴다.
- **발견 화면이 등록을 대신하기.** 버튼을 만들지 않는다. 등록은 AI와 사람의 명시적 행위다.
- **경로 변경으로 링크 깨기.** 리다이렉트를 두고 실제로 띄워서 확인한다.
- **요약 문자열이 흔들리기.** 정렬하지 않으면 조회 순서에 따라 달라진다. Task 1에서 테스트로 고정한다.
