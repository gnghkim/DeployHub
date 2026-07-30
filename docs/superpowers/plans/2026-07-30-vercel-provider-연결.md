# Vercel Provider 연결 Implementation Plan

> **For agentic workers:** orca orchestration으로 codex 워커에게 카드 단위 위임된다. 각 Task는 격리 worktree에서 수행하고, 검증 명령이 모두 통과한 뒤 Claude의 설계 부합 검토를 거쳐 main에 병합한다.

**Goal:** Vercel 수집 파이프라인의 마지막 한 칸을 채운다 — 사람이 관리화면에서 Vercel 토큰을 넣어 `provider_accounts`에 vercel 계정을 만들 수 있게 하고, 이미 돌고 있는 `vercel.sync` 스케줄러가 그 계정을 실제로 집어가게 한다.

**전제:** 운영 중이다. 이 변경은 hub.nolzza.net 에 배포된다. 마이그레이션은 되돌리기 어렵다.

---

## 지금 상태 — 파이프라인은 다 깔려 있고 입구만 없다

2026-07-30 기준으로 코드를 확인한 결과다.

| 계층 | 위치 | 상태 |
|---|---|---|
| 수집기 | `packages/collectors/src/vercel/index.ts:96` `createVercelCollector(token, teamId?)` | 있음. `ProviderCollector` 구현 (`testConnection`/`listResources`/`listDeployments`) |
| 워커 핸들러 | `apps/worker/src/handlers/vercel-sync.ts:49` `createVercelSyncHandler` | 있음. `vercel.sync` 로 등록됨 (`apps/worker/src/index.ts:43`) |
| 주기 스케줄 | `apps/worker/src/index.ts:54` `enqueueVercelSyncJobs` | 돌고 있음. **매번 계정 0건을 조회하고 job 없이 끝난다** |
| 자동 링크 규칙 | `packages/db/src/queries/declared-link.ts:92` | 있음. `vercel_project` 분기 존재 |
| **vercel 계정 생성 경로** | — | **없음** |

`apps/web/src/actions/providers.ts` 에는 `saveGithubProvider`(18행)와 `enqueueGithubSync`(73행)뿐이고 `provider: 'github'` 이 하드코딩돼 있다. `apps/web/src/app/settings/providers/page.tsx:47` 은 `provider = 'github'` 으로 필터한다. 그래서 화면에 GitHub 하나만 보인다.

DB 확인: `provider_accounts` 에 github 계정 1건(gnghkim)뿐. `resources` 에 vercel 행 0건.

---

## 결정

| 항목 | 결정 | 근거 |
|---|---|---|
| teamId 저장 위치 | **`provider_accounts.external_account_id` (nullable text) 를 새로 추가한다** | `name` 은 표시용이고 `(provider, name)` 유일 제약에 묶여 있다. 동작에 쓰이는 값을 표시 이름에 실으면 이름을 바꾸는 순간 동기화가 깨진다 |
| 핸들러의 teamId 전달 | **`vercel-sync.ts:79` 의 `createCollector(token)` 을 `createCollector(token, account.externalAccountId ?? undefined)` 로 고친다** | 지금은 teamId 를 저장해도 동기화가 무시한다. 이걸 안 고치면 팀 계정은 연결됐다고 표시된 채 프로젝트 0건이 된다 |
| 수집기 수정 | **하지 않는다** | `createVercelCollector` 는 이미 teamId 를 받고, `testConnection` 이 `teamId ?? 'vercel'` 을 계정 이름으로 돌려준다. 그대로 쓴다 |
| `resolveDeclaredLink` 수정 | **하지 않는다.** vercel 은 `externalRef` 완전일치만 자동 링크 | 이름 유사도로 링크하면 오연결이 조용히 생긴다. 매칭 안 된 자원은 `/settings/resources` 에서 사람이 수동 링크한다(`confirmResourceLink`, `linkedBy='user'`) |
| GitHub 액션 | **시그니처를 유지한다** | 기존 호출부와 `providers.test.ts` 를 깨뜨리지 않는다. 공통 로직만 뽑아 쓴다 |

**범위 밖:** manifest 에 `externalRef` 를 넣는 일(각 프로젝트 저장소의 `deployhub.yaml` 몫), Vercel 외 provider(supabase 등), 배포 이력 화면.

---

## Task 1 — vercel 계정 저장 경로

**worktree:** `feat/vercel-provider-action`

### 1-1. 스키마

`packages/db/src/schema/resources.ts` 의 `providerAccounts` 에 컬럼을 하나 더한다.

```ts
externalAccountId: text('external_account_id'),
```

nullable 이다. 기존 github 행은 NULL 로 남는다. 유일 제약은 건드리지 않는다.

Run: `pnpm --filter @deployhub/db exec drizzle-kit generate`

생성된 SQL 이 `ALTER TABLE ... ADD COLUMN` 한 줄인지 확인한다. **기존 컬럼을 지우거나 이름을 바꾸는 문장이 섞여 있으면 멈추고 보고한다.**

### 1-2. 액션

`apps/web/src/actions/providers.ts` 에 추가한다.

```ts
export async function saveVercelProvider(
  _previousState: ProviderActionState,
  formData: FormData,
): Promise<ProviderActionState>

export async function enqueueVercelSync(formData: FormData): Promise<void>
```

`saveGithubProvider` 와 같은 순서로 동작한다: 세션 확인 → 입력 검증 → `testConnection()` → 실패 시 `CONNECTION_ERROR` 반환 → 성공 시 `encrypt` 후 `onConflictDoUpdate` → `revalidatePath('/settings/providers')`.

Vercel 만의 차이 세 가지다.

- 폼 필드가 둘이다. `token`(필수), `teamId`(선택). 둘 다 `trim()` 한다.
- `teamId` 가 빈 문자열이면 `undefined` 로 바꿔 `createVercelCollector(token, teamId)` 에 넘긴다. **빈 문자열을 그대로 넘기면 `?teamId=` 가 붙은 요청이 나간다.**
- 저장 시 `name: connection.account`, `externalAccountId: teamId ?? null`.

토큰은 평문으로 로그·응답·에러 메시지에 남기지 않는다.

### 1-3. 워커

`apps/worker/src/handlers/vercel-sync.ts` 에서 계정 조회 결과의 `externalAccountId` 를 collector 에 넘긴다(결정표 2행).

### 수용 기준

- [ ] `drizzle/` 에 마이그레이션 1건이 추가되고 내용이 `ADD COLUMN external_account_id` 뿐이다
- [ ] `saveVercelProvider` 가 비로그인 시 throw 한다
- [ ] 토큰이 빈 문자열이면 DB 접근 없이 error 상태를 반환한다
- [ ] `testConnection()` 이 `ok: false` 면 저장하지 않고 error 상태를 반환한다
- [ ] 성공 시 `provider: 'vercel'`, `externalAccountId` 가 저장되고 같은 `(provider, name)` 재연결이 update 로 처리된다
- [ ] `teamId` 가 빈 문자열이면 `createVercelCollector` 의 2번째 인자가 `undefined` 다 (테스트로 단언)
- [ ] `enqueueVercelSync` 가 `type: 'vercel.sync'`, `payload: { accountId }` 로 enqueue 한다
- [ ] vercel-sync 핸들러가 `externalAccountId` 를 collector 2번째 인자로 넘긴다 (기존 핸들러 테스트에 케이스 추가)
- [ ] 기존 `providers.test.ts` 의 github 케이스가 수정 없이 통과한다

### 검증

```
pnpm typecheck
pnpm test
```

---

## Task 2 — Providers 화면 일반화

**worktree:** `feat/vercel-provider-ui`
**선행:** Task 1 병합 후 시작한다.

`apps/web/src/app/settings/providers/page.tsx` 를 provider 하나 전용에서 섹션 구조로 바꾼다.

- 계정 조회에서 `provider = 'github'` 필터를 없애고 provider 별로 나눈다. `provider` 도 select 목록에 넣는다.
- GitHub 섹션은 지금 보이는 것과 동일하게 유지한다(연결 폼 + 계정 카드 + `지금 동기화`).
- Vercel 섹션을 같은 모양으로 추가한다. 연결 폼에 `token`(password) 과 `teamId`(text, 선택) 두 입력을 둔다. `teamId` 에는 "개인 계정이면 비워둡니다" 안내를 붙인다.
- 계정 카드의 토큰 뒷자리·마지막 확인·마지막 동기화·`lastError` 표시는 두 provider 가 같은 컴포넌트를 쓴다. 지금 page.tsx 안에 인라인으로 있는 카드 마크업을 `components/` 아래로 뽑는다.
- 연결된 계정이 없는 provider 는 빈 상태 문구를 그대로 보여준다.

기존 디자인 토큰(`var(--line)`, `var(--annotation)`, `var(--fault)`)과 `Card`/`Input`/`Button` 을 그대로 쓴다. 새 색이나 새 컴포넌트 스타일을 만들지 않는다.

### 수용 기준

- [ ] `/settings/providers` 에 GitHub·Vercel 두 섹션이 보인다
- [ ] GitHub 섹션의 동작·표시가 변경 전과 같다
- [ ] Vercel 폼 제출이 `saveVercelProvider` 로 간다
- [ ] Vercel 계정 카드의 `지금 동기화` 가 `enqueueVercelSync` 로 간다
- [ ] 계정 0건인 provider 에 빈 상태 문구가 나온다
- [ ] 토큰 원문이 DOM 어디에도 렌더되지 않는다 (뒷 4자리만)

### 검증

```
pnpm typecheck
pnpm test
pnpm --filter @deployhub/web build
```

---

## 병합 후 — 사람이 하는 확인

코드 검증만으로는 연결이 실제로 되는지 알 수 없다. 배포 후 아래를 순서대로 본다.

1. 마이그레이션 적용: `pnpm --filter @deployhub/db exec drizzle-kit migrate`
2. `/settings/providers` 에서 Vercel 토큰을 넣고 연결. 실패하면 토큰 스코프부터 의심한다
3. `지금 동기화` 후 `/settings/resources` 에 `vercel_project` 자원이 뜨는지
4. yield 의 frontend 는 `externalRef` 가 없으므로 **Unlinked 로 남는 게 정상이다.** 여기서 수동 링크하거나, `C:\Dev\Yield\deployhub.yaml` 의 frontend 에 Vercel 프로젝트 ID(`prj_...`)를 `externalRef` 로 넣고 `sync --draft` 를 다시 돌린다

4번 중 어느 쪽을 택할지는 확인 시점에 정한다. `externalRef` 를 넣는 편이 다음 재등록에도 유지된다.
