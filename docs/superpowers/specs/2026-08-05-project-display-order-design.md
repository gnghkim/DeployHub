# 프로젝트 목록 표시 순서 변경 설계

## 목표

프로젝트 목록의 표시 순서를 사용자가 직접 정한다. 카드 헤더의 드래그
핸들을 잡고 위아래로 옮기면 그 순서가 서버에 저장되어 모든 브라우저와
기기에서 동일하게 보인다.

현재 목록은 `listProjects`의 `orderBy(asc(projects.name))`로 이름
오름차순에 고정되어 있다. `importance` 컬럼이 있지만 편집 화면과 상세
화면에서만 쓰이고 정렬에는 반영되지 않는다.

## 사용자 경험

- 각 카드 헤더 맨 왼쪽, 접기 화살표보다 바깥에 드래그 핸들을 표시한다.
- 드래그는 핸들에서만 시작한다. 카드 본문의 이름 링크, 접기 버튼,
  구성요소 URL, 스냅샷 링크는 지금과 똑같이 동작한다.
- 드래그 중에는 옮기는 카드를 반투명하게 표시하고, 포인터가 이웃 카드의
  중앙선을 넘을 때마다 목록이 즉시 재배치된다.
- 포인터를 놓는 순간 저장한다. 별도 저장 버튼이나 편집 모드는 없다.
- 핸들에 포커스한 상태에서 `↑` `↓`로도 한 칸씩 옮길 수 있다. 저장 경로는
  드래그와 같다.
- Draft 승인이나 수동 등록으로 새 프로젝트가 생기면 목록 맨 위에 놓는다.
- 기능 배포 직후 목록은 지금과 동일한 이름 오름차순으로 보인다.

## 데이터 모델

`projects` 테이블에 컬럼 하나를 추가한다.

```ts
displayOrder: integer('display_order').notNull().default(0),
```

인덱스는 두지 않는다. 행이 수십 개 규모라 순차 스캔이 더 빠르고, 정렬
키가 재정렬마다 통째로 다시 쓰이므로 인덱스는 유지 비용만 남는다.

마이그레이션은 `drizzle/0011_project_display_order.sql`이다. drizzle-kit이
생성한 `ALTER TABLE`에 백필 한 문장을 덧붙인다. `0008_component_health_url.sql`,
`0009_project_snapshots.sql`처럼 손으로 이름 붙인 선례를 따른다.

```sql
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY name) - 1 AS position FROM projects
)
UPDATE projects SET display_order = ordered.position
FROM ordered WHERE projects.id = ordered.id;
```

백필은 아카이브된 프로젝트에도 값을 넣는다. 목록이 이미 `archivedAt`으로
거르므로 화면에는 영향이 없다. 다만 이후 재정렬은 아카이브되지 않은 행만
`0..n-1`로 정규화하므로, 복구된 프로젝트는 기존 행과 값이 겹칠 수 있다.
그 경우 정렬의 이름 타이브레이크로 자리가 갈리고, 사용자가 한 번 끌어
옮기면 다시 정규화된다.

## 읽기 경로

`packages/db/src/queries/projects.ts`에 `listProjectsInDisplayOrder(db)`를
추가한다. 조건은 `listProjects`와 같은 `isNull(projects.archivedAt)`이고
정렬만 `asc(displayOrder), asc(name)`이다. 이름 타이브레이크는 백필 이전
행이나 동시 삽입으로 값이 겹칠 때 순서가 요동치지 않게 하는 안전장치다.

`listProjectsWithSummaryData`가 이 함수를 쓴다.

`listProjects`는 이름 오름차순 그대로 둔다. 이 함수는 목록 화면 외에
`/events`와 `/settings/resources`의 프로젝트 선택 드롭다운에서도 쓰이는데,
드롭다운은 이름순이 맞다.

## 쓰기 경로

`apps/web/src/actions/projects.ts`에 서버 액션을 추가한다.

```ts
reorderProjects(orderedIds: string[]): Promise<{ status: 'success' | 'stale' | 'error' }>
```

1. `auth()` 가드. 세션이 없으면 기존 액션들과 같이 던진다.
2. 입력 검증: UUID 배열, 최소 1개, 중복 없음.
3. 트랜잭션 안에서 아카이브되지 않은 프로젝트 id 집합을 읽어 요청 배열과
   정확히 일치하는지 검사한다. 누락·초과·미지의 id가 하나라도 있으면
   아무것도 쓰지 않고 `stale`을 반환한다.
4. 일치하면 `UPDATE ... FROM (VALUES ...)` 한 문장으로 `0..n-1`을 부여한다.
5. `revalidatePath('/')`.

3번이 이 액션의 핵심이다. 이것이 없으면 다른 탭에서 Draft를 승인한 뒤
낡은 배열로 저장할 때 새 프로젝트가 순서에서 탈락한다.

## 새 프로젝트 진입

`packages/db`에 `nextTopDisplayOrder(tx)` 헬퍼를 둔다.

```sql
select coalesce(min(display_order), 0) - 1 from projects
```

두 삽입 지점에서 쓴다.

- `apps/web/src/actions/drafts.ts`의 승인 insert. 현재 `projectValues`에
  순서 값이 없다. 이미 트랜잭션 안이라 읽기와 쓰기 사이에 경쟁이 없다.
- `apps/web/src/actions/projects.ts`의 `createProject`.

값이 음수가 되지만 다음 재정렬 때 `0..n-1`로 정규화되므로 그대로 둔다.

## 클라이언트 컴포넌트

`apps/web/src/components/schematic/project-order-list.tsx` (`'use client'`)

서버에서 렌더한 `ProjectSheet`들을 `items: Array<{ id: string; name: string;
node: ReactNode }>`로 받는다. 서버 컴포넌트 결과를 클라이언트 컴포넌트의
자식으로 넘기는 구조라 카드 자체는 서버 컴포넌트로 남고,
`componentObservations`의 `Map` 같은 서버 전용 자료구조가 클라이언트
경계를 넘지 않는다. `project-sheet-collapse.tsx`가 이미 쓰는 패턴이다.

동작:

- `pointerdown` on 핸들 → `setPointerCapture`, 각 `<li>`의
  `getBoundingClientRect()`를 한 번 수집한다.
- `pointermove` → 포인터 y가 이웃 항목의 중앙선을 넘으면
  `moveItem(order, from, to)`로 낙관적 배열을 갱신한다.
- `pointerup` → `startTransition`으로 `reorderProjects(order)` 호출.
  `stale`이나 `error`면 `router.refresh()`로 서버 상태를 되돌린다.
- 핸들에 `touch-action: none`을 걸어 드래그가 스크롤에 먹히지 않게 한다.

재배치 계산은 `moveItem(order, from, to)` 순수 함수로 분리해 별도 파일에
둔다. 드롭 애니메이션은 넣지 않는다.

`apps/web/src/app/page.tsx`는 `<ul>` 대신 이 컴포넌트를 렌더한다. 빈 목록
안내와 발견 링크는 그대로 둔다.

## 접근성

- 핸들은 `<button type="button">`이고 접근 가능한 이름은
  `{프로젝트명} 순서 이동`이다.
- 포커스된 핸들에서 `ArrowUp` / `ArrowDown`이 한 칸씩 옮기고
  `preventDefault`로 페이지 스크롤을 막는다.
- 이동 후 `aria-live="polite"` 영역에 `{프로젝트명}, {n}번째`를 알린다.
- 목록 맨 위 항목의 `↑`, 맨 아래 항목의 `↓`는 아무 일도 하지 않는다.

## 테스트

- `packages/db`: `listProjectsInDisplayOrder`가 `displayOrder` 오름차순으로
  반환하고 같은 값에서는 이름으로 갈리는지, 아카이브된 프로젝트를 제외하는지.
- `packages/db`: `nextTopDisplayOrder`가 현재 최솟값보다 작은 값을 주고,
  빈 테이블에서 `-1`을 주는지.
- `packages/db`: 마이그레이션 백필이 기존 행에 이름 오름차순 위치를 넣는지
  (`migrations.test.ts` 패턴).
- `apps/web/src/actions/projects.test.ts`: 미인증 거부, id 집합 불일치 시
  `stale`을 반환하고 아무 행도 바뀌지 않음, 정상 저장 후 값이 `0..n-1`.
- `apps/web`: Draft 승인으로 만든 프로젝트가 기존 최솟값보다 작은
  `displayOrder`를 받는지.
- `moveItem` 단위 테스트: 위로, 아래로, 제자리, 경계.

드래그 제스처 자체는 자동 테스트하지 않는다. jsdom에는 레이아웃이 없어
`getBoundingClientRect()`가 전부 0을 반환하므로 중앙선 판정을 의미 있게
검증할 수 없다. 순수 함수와 서버 액션으로 로직을 덮고, 실제 드래그와
터치 동작은 배포 후 수동 확인 항목으로 남긴다.

## 범위 제외

- 정렬 기준 선택(이름순, 최근 배포순, 중요도순) 전환 UI
- `importance` 컬럼을 정렬에 반영하는 것
- 여러 프로젝트를 한 번에 선택해 옮기기
- 드롭 애니메이션과 자동 스크롤
- 프로젝트 그룹이나 폴더
- 사용자별 순서. 이 시스템은 단일 관리자를 전제하므로 순서는 전역이다.
