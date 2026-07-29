# DeployHub 프론트엔드 재디자인 Implementation Plan

> **For agentic workers:** orca orchestration 으로 codex 워커에게 카드 단위 위임된다. 각 Task 는 격리 worktree 에서 수행하고, 검증 명령이 모두 통과한 뒤 Claude 의 설계 부합 검토를 거쳐 main 에 병합한다.

**Goal:** 시각 언어를 DeployHub 자신의 개념에서 다시 끌어내고, 선언과 관측의 구분을 매일 보는 네 화면 전체가 말하게 만든다.

**Architecture:** 기계 도면의 은유를 쓴다. 선언은 그려진 선이고 관측은 실측 주기다. `┆` 구분자 왼쪽이 사람이 말한 것, 오른쪽이 기계가 본 것이다. 토큰을 Raycast 표면 이름에서 이 시스템의 의미 이름으로 바꾸고, 그 위에 공용 부품을 다시 세운 뒤, 네 화면에 같은 규칙을 적용한다.

**Tech Stack:** 기존 스택. Next.js 16.2.12 · Tailwind CSS 4.3.3 (CSS-first `@theme`) · TypeScript 6.0.3 · Vitest 4.1.10. **새 외부 의존성 없음. 웹폰트 없음.**

**선행:** `docs/superpowers/specs/2026-07-29-deployhub-프론트엔드-재디자인-design.md`

---

## Global Constraints

M1·M2·M3 의 Global Constraints 를 그대로 승계하고 아래를 더한다.

- **새 외부 의존성을 넣지 않는다.** 그래프 라이브러리·아이콘 패키지·애니메이션 라이브러리 전부 해당한다.
- **웹폰트를 추가하지 않는다.** `@font-face` 도, 폰트 CDN 링크도 없다. 지금 Inter 도 스택으로만 쓰고 있다.
- **데이터 조회의 의미를 바꾸지 않는다.** 이 작업은 표현만 바꾼다.
- **판정 규칙을 새로 만들지 않는다.** M3 의 `judgeStatus` 를 쓴다.
- **Drift 판별을 새로 만들지 않는다.** `packages/db/src/queries/drift.ts` 의 `computeDrift` 를 쓴다.
- **관측 없음을 선언값으로 채우지 않는다.** `┆ —` 로 비운다.
- **정상 판정에 색을 쓰지 않는다.** 대부분이 정상이라 색을 주면 진짜 경고가 묻힌다.
- **Drift 를 경고색으로 칠하지 않는다.** 선언과 관측이 다른 것은 사실의 진술이지 장애가 아니다.
- **라이트 모드를 만들지 않는다.**
- **새 테이블이나 마이그레이션을 만들지 않는다.**
- **조회 수가 프로젝트 수에 비례하면 안 된다.**
- **`md` 미만에서도 읽혀야 한다.** 여백은 `p-4 md:p-8`.
- **운영 DB 나 VPS 에 접속하지 않는다.** 배포는 사람이 한다.

---

## 이름 규칙 — 전 카드 공통

토큰 이름이 바뀐다. 아래가 유일한 정본이다.

| 옛 이름 | 새 이름 | 값 |
|---|---|---|
| `--color-canvas` | `--canvas` | `#07080a` |
| `--color-surface` | `--paper` | `#0d0d0d` |
| `--color-surface-elevated` | `--paper` | `#0d0d0d` |
| `--color-surface-card` | `--paper` | `#0d0d0d` |
| `--color-ink` | `--line` | `#f4f4f6` |
| `--color-body` | `--line-mute` | `#cdcdcd` |
| `--color-mute` | `--annotation` | `#9c9c9d` |
| `--color-ash` | `--absent` | `#6a6b6c` |
| `--color-hairline` | `--rule` | `#242728` |
| `--color-error` | `--fault` | `#ff6161` |
| `--color-warning` | `--caution` | `#ffc533` |
| `--color-success` | `--confirm` | `#59d499` |
| `--color-info` | `--accent` | `#57c1ff` |
| (신규) | `--grid` | `#16181a` |
| `--radius-badge` | `--radius-button` | `8px` |
| `--radius-row` | `--radius-button` | `8px` |
| `--radius-modal` | 삭제 | — |

Tailwind CSS 4 의 `@theme` 는 `--color-*` 접두사를 유틸리티 클래스로 노출한다. 이 프로젝트는 유틸리티를 쓰지 않고 `text-[var(--color-ink)]` 형태의 임의값만 쓰므로 접두사를 뗀다. **`@theme` 대신 `:root` 에 정의한다.**

---

## Task 1: 토큰과 DESIGN.md

나머지 네 카드의 전제다. 이 카드가 없으면 나머지가 참조할 이름이 없다.

**Files:**
- Modify: `apps/web/src/app/globals.css`
- Create: `DESIGN.md`
- Delete: `DESIGN-raycast.md`
- Modify: 옛 토큰을 쓰는 모든 `.tsx` (기계적 치환)
- Test: `apps/web/src/app/design-tokens.test.ts` (신규)

**Interfaces:**
- Produces: 위 "이름 규칙" 표의 CSS 변수 전부. Task 2~5 가 이 이름만 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/web/src/app/design-tokens.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_DIR = join(process.cwd(), 'src');
const GLOBALS = join(SOURCE_DIR, 'app', 'globals.css');

function allSourceText(): string {
  const { execSync } = require('node:child_process') as typeof import('node:child_process');
  const files = execSync('git ls-files "src/**/*.tsx" "src/**/*.ts" "src/**/*.css"', {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.endsWith('design-tokens.test.ts'));
  return files.map((file) => readFileSync(join(process.cwd(), file), 'utf8')).join('\n');
}

const RETIRED = [
  '--color-canvas', '--color-surface', '--color-surface-elevated',
  '--color-surface-card', '--color-ink', '--color-body', '--color-mute',
  '--color-ash', '--color-hairline', '--color-error', '--color-warning',
  '--color-success', '--color-info', '--radius-badge', '--radius-row',
  '--radius-modal',
];

const REQUIRED = [
  '--canvas', '--paper', '--grid', '--rule', '--line', '--line-mute',
  '--annotation', '--absent', '--fault', '--caution', '--confirm', '--accent',
  '--radius-card', '--radius-button', '--font-sans', '--font-mono',
];

describe('design tokens', () => {
  it('defines every required token exactly once', () => {
    const css = readFileSync(GLOBALS, 'utf8');
    for (const token of REQUIRED) {
      const occurrences = css.split(`${token}:`).length - 1;
      expect(occurrences, `${token} definition count`).toBe(1);
    }
  });

  it('has no retired token left anywhere in the app', () => {
    const text = allSourceText();
    for (const token of RETIRED) {
      expect(text, `${token} should be gone`).not.toContain(token);
    }
  });

  it('loads no web font', () => {
    const text = allSourceText();
    expect(text).not.toContain('@font-face');
    expect(text).not.toContain('fonts.googleapis.com');
    expect(text).not.toContain('fonts.gstatic.com');
    expect(text).not.toContain('next/font');
  });

  it('caps type scale at 20px', () => {
    const css = readFileSync(GLOBALS, 'utf8');
    expect(css).not.toContain('64px');
    expect(css).not.toContain('56px');
  });
});
```

`--color-surface` 는 `--color-surface-elevated` 의 접두사이므로 `not.toContain` 이 둘 다 잡는다. 의도된 것이다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter web exec vitest run src/app/design-tokens.test.ts`
Expected: FAIL — 옛 토큰이 아직 100곳 넘게 남아 있다.

- [ ] **Step 3: globals.css 교체**

```css
@import "tailwindcss";

:root {
  color-scheme: dark;

  /* 제도면 */
  --canvas:      #07080a;
  --paper:       #0d0d0d;
  --grid:        #16181a;
  --rule:        #242728;

  /* 선언과 관측 */
  --line:        #f4f4f6;
  --line-mute:   #cdcdcd;
  --annotation:  #9c9c9d;
  --absent:      #6a6b6c;

  /* 상태 */
  --fault:       #ff6161;
  --caution:     #ffc533;

  /* 상호작용 — 상태가 아니다 */
  --confirm:     #59d499;
  --accent:      #57c1ff;

  --radius-card:   10px;
  --radius-button: 8px;

  --font-sans: Inter, "Noto Sans KR", system-ui, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
}

html, body {
  background-color: var(--canvas);
  color: var(--line-mute);
  font-family: var(--font-sans);
  font-feature-settings: "calt", "kern", "liga";
}

/* 도면 블록에만 격자를 깐다. 페이지 바탕은 민무늬다. */
.sheet {
  background-color: var(--paper);
  background-image:
    repeating-linear-gradient(to right,  var(--grid) 0 1px, transparent 1px 32px),
    repeating-linear-gradient(to bottom, var(--grid) 0 1px, transparent 1px 32px);
}
```

- [ ] **Step 4: 기계적 치환**

`apps/web/src` 아래 모든 `.tsx` 에서 옛 이름을 새 이름으로 바꾼다. 위 표가 정본이다.

`--color-surface-elevated` 와 `--color-surface-card` 는 둘 다 `--paper` 로 접힌다. 접은 뒤 **같은 요소 안에서 배경이 겹쳐 경계가 사라지는 곳**이 생긴다. 그런 곳은 배경 대신 `border border-[var(--rule)]` 로 경계를 만든다. 배경색을 새로 만들지 마라.

치환 후 `--color-` 로 시작하는 문자열이 하나도 남지 않아야 한다.

- [ ] **Step 5: 통과 확인**

Run: `pnpm --filter web exec vitest run src/app/design-tokens.test.ts`
Expected: PASS 4/4

- [ ] **Step 6: DESIGN.md 작성과 DESIGN-raycast.md 삭제**

`DESIGN.md` 를 새로 쓴다. 담을 것:

1. 시각 방향 — 어두운 제도면. 선언은 그려진 선, 관측은 실측 주기
2. `┆` 규칙과 파생 규칙 표 (관측 없음 / 선언 없음 / Drift)
3. 위 토큰 표 전부와 각 토큰의 **쓰임**
4. 타이포 — 잰 것은 모노, 말은 산세리프. 크기 5단계
5. 격자는 도면 블록에만
6. 하지 말 것 — 정상에 색 쓰기, Drift 를 경고색으로 칠하기, 관측 없음을 선언으로 채우기, 웹폰트 추가, 라이트 모드

`git rm DESIGN-raycast.md` 로 지운다.

**왜 지우는지 `DESIGN.md` 첫 문단에 남겨라.** 설계 근거 문서가 다른 회사 마케팅 페이지 분석이면 다음에 화면을 고치는 사람이 또 거기서 답을 찾는다.

- [ ] **Step 7: 검증과 커밋**

```bash
pnpm typecheck
pnpm test
pnpm --filter web build
git grep -n -- "--color-" -- apps/web/src   # 0건이어야 한다
git add -A && git commit
```

**게이트 통과 조건:** 옛 토큰 0건. 웹폰트 0건. `DESIGN-raycast.md` 삭제됨. 기존 테스트 전부 통과.

---

## Task 2: 공용 부품과 껍데기

Task 3~5 가 쓰는 부품을 만든다.

**Files:**
- Modify: `apps/web/src/components/ui/{badge,button,card,input,status-dot,table}.tsx`
- Modify: `apps/web/src/components/shell/{sidebar-shell,topbar}.tsx`
- Create: `apps/web/src/components/schematic/{sheet,annotation}.tsx`
- Test: `apps/web/src/components/schematic/annotation.test.ts` (신규)
- Modify: `apps/web/src/app/page.tsx` (`STATUS_TONES` 의 tone 이름만)

**Interfaces:**

- Consumes: Task 1 의 토큰 이름 전부.
- Produces:

```ts
// components/schematic/sheet.tsx
export function Sheet({ children, className }: {
  children: ReactNode;
  className?: string;
}): JSX.Element;

// components/schematic/annotation.tsx
/** 관측값 한 칸. value 가 null 이면 '—' 를 --absent 로 렌더한다. */
export function Annotation({ value, drift }: {
  value: string | null;
  drift?: boolean;
}): JSX.Element;

// components/ui/badge.tsx
export type Tone = 'fault' | 'caution' | 'confirm' | 'accent' | 'neutral';
```

- [ ] **Step 1: 실패하는 테스트 작성**

`apps/web/src/components/schematic/annotation.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ANNOTATION = readFileSync(
  join(process.cwd(), 'src/components/schematic/annotation.tsx'),
  'utf8',
);
const BADGE = readFileSync(
  join(process.cwd(), 'src/components/ui/badge.tsx'),
  'utf8',
);
const ROOT = readFileSync(join(process.cwd(), 'src/app/page.tsx'), 'utf8');

describe('Annotation', () => {
  it('renders an em dash in --absent when there is no observation', () => {
    expect(ANNOTATION).toContain('—');
    expect(ANNOTATION).toContain('var(--absent)');
  });

  it('marks drift with a symbol and never with a colour', () => {
    expect(ANNOTATION).toContain('≠');
    expect(ANNOTATION).not.toContain('var(--fault)');
    expect(ANNOTATION).not.toContain('var(--caution)');
  });

  it('renders observed values in the mono stack', () => {
    expect(ANNOTATION).toContain('font-mono');
  });
});

describe('status tones', () => {
  it('has no success tone that could colour a normal state', () => {
    expect(BADGE).not.toContain("success:");
    expect(BADGE).not.toContain("info:");
  });

  it('keeps 정상 and 미확인 colourless', () => {
    const tones = ROOT.slice(ROOT.indexOf('STATUS_TONES'), ROOT.indexOf('};', ROOT.indexOf('STATUS_TONES')));
    expect(tones).toMatch(/정상:\s*'neutral'/);
    expect(tones).toMatch(/미확인:\s*'neutral'/);
  });
});
```

마지막 단언이 이 카드의 요점이다. **정상에 색을 쓰지 않는 규칙을 기계로 고정한다.** M3 에서 정했지만 지금은 지켜지고 있을 뿐 강제되지 않는다.

- [ ] **Step 2: 실패 확인**

Run: `pnpm --filter web exec vitest run src/components/schematic/annotation.test.ts`
Expected: FAIL — `annotation.tsx` 가 없다.

- [ ] **Step 3: Sheet 구현**

```tsx
import type { ReactNode } from 'react';

export function Sheet({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`sheet rounded-[var(--radius-card)] border border-[var(--rule)] p-4 md:p-5 ${className}`}
    >
      {children}
    </section>
  );
}
```

`sheet` 클래스가 격자를 만든다. Task 1 의 `globals.css` 에 정의돼 있다.

- [ ] **Step 4: Annotation 구현**

```tsx
export function Annotation({
  value,
  drift = false,
}: {
  value: string | null;
  drift?: boolean;
}) {
  if (value === null) {
    return (
      <span className="font-mono text-xs text-[var(--absent)]">
        <span aria-hidden="true">┆ </span>
        <span className="sr-only">관측되지 않음</span>
        <span aria-hidden="true">—</span>
      </span>
    );
  }

  return (
    <span className="font-mono text-xs text-[var(--annotation)]">
      <span aria-hidden="true">┆ </span>
      <span className="sr-only">관측</span>
      {drift ? (
        <>
          <span aria-hidden="true">≠ </span>
          <span className="sr-only">선언과 다름</span>
        </>
      ) : null}
      {value}
    </span>
  );
}
```

`┆` 는 장식이라 `aria-hidden` 이다. 스크린리더에는 "관측" 이라는 말이 들어가야 한다. 기호만으로는 읽히지 않는다.

- [ ] **Step 5: Tone 이름 교체**

**주의 — Task 1 이 심어 둔 지뢰가 있다.** `apps/web/src/components/ui/tokens.test.ts`
가 이렇게 단언한다.

```ts
expect(projectDetail).toContain("tone={conflict ? 'error' : 'neutral'}");
```

`'error'` 를 문자열로 박아 놨다. 이 Step 이 `error` → `fault` 로 바꾸는 순간 그
테스트가 깨진다. **함께 고쳐라.** 테스트를 지우지 말고 새 이름으로 갱신한다.


`badge.tsx`:

```tsx
const TONES = {
  fault: 'text-[var(--fault)]',
  caution: 'text-[var(--caution)]',
  confirm: 'text-[var(--confirm)]',
  accent: 'text-[var(--accent)]',
  neutral: 'text-[var(--annotation)]',
} as const;

export type Tone = keyof typeof TONES;
```

`status-dot.tsx` 도 같은 키로 바꾼다.

호출부를 전부 고친다. 옛 이름 → 새 이름: `error`→`fault`, `warning`→`caution`, `success`→`confirm`, `info`→`accent`. `neutral` 은 그대로다.

**`STATUS_TONES` 의 정상·미확인은 `neutral` 로 유지한다.** 바꾸지 마라.

- [ ] **Step 6: 나머지 부품**

`card.tsx` 는 `bg-[var(--paper)]` 를 쓰되 격자는 넣지 않는다. 격자는 `Sheet` 만 쓴다. 카드와 도면은 다른 물건이다.

`table.tsx` 의 hover 배경은 `--paper` 로 접히면 구분이 안 된다. 배경 대신 `hover:border-l-2 hover:border-l-[var(--annotation)]` 처럼 선으로 표시하거나, `hover:bg-white/[0.02]` 를 쓴다. **새 색 토큰을 만들지 마라.**

`input.tsx`·`button.tsx` 의 포커스는 `--accent` 다. 지우지 마라 — 접근성이다.

`topbar.tsx` 의 제목은 20px(`text-xl`) 이하로 둔다. 햄버거를 위한 `pl-16 md:px-8` 을 유지한다.

`sidebar-shell.tsx` 는 항목과 드로어 동작을 건드리지 마라. 색 이름만 바꾼다.

- [ ] **Step 7: 검증과 커밋**

```bash
pnpm typecheck
pnpm test
pnpm --filter web build
git grep -n "tone=\"success\"\|tone=\"info\"\|tone=\"error\"\|tone=\"warning\"" -- apps/web/src   # 0건
```

**게이트 통과 조건:** `Annotation` 이 관측 없음을 `—` 로 렌더할 것. Drift 에 색이 없을 것. 정상·미확인이 `neutral` 일 것. 포커스 링이 살아 있을 것.

---

## Task 3: 루트 화면

**Files:**
- Modify: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/components/schematic/project-sheet.tsx`
- Modify: `packages/db/src/queries/projects.ts`
- Test: `apps/web/src/components/schematic/project-sheet.test.ts` (신규), `packages/db/src/queries/projects.test.ts` (확장)

**Interfaces:**

- Consumes: Task 2 의 `Sheet`, `Annotation`, `Badge`, `Tone`.
- Produces:

```ts
// packages/db/src/queries/projects.ts — 기존 타입 확장
export type ProjectListSummaryData = ProjectRow & {
  components: ComponentRow[];
  observedProviders: string[];
  latestDeploymentAt: Date | null;
  /** 구성요소 id → 관측된 컨테이너 이름과 상태. 없으면 키가 없다. */
  componentObservations: Map<string, { name: string; state: string }>;
};
```

- [ ] **Step 1: 실패하는 조회 테스트 작성**

`packages/db/src/queries/projects.test.ts` 에 더한다:

**조회 수 단언은 이미 있다.** `packages/db/src/queries/projects.test.ts:178` 이
`expect(oneProjectQueryCount).toBe(5)` 로 고정하고 있다. 파일 상단의 `countedDb`
(drizzle `logger.logQuery` 로 `queryCount` 를 세는 인스턴스)를 그대로 쓴다.
**새 헬퍼를 만들지 마라.**

**조회를 새로 더하지 마라. 있는 것을 넓혀라.**

`listProjectsWithSummaryData` 안의 두 번째 조회(`linkedResourceRows`)가 이미
`componentResources` → `components` → `resources` 를 조인하고 있다. 지금은
`projectId` 와 `provider` 두 열만 뽑는다. 여기에 `componentId`·`name`·`status` 를
더하면 된다.

`resources.name` 과 `resources.status` 는 **최상위 열**이다. `metadata` 안이
아니다. `docker.sync` 가 `Name` 의 앞 슬래시를 떼어 `name` 에 넣는다.

이러면 **조회 수가 5회 그대로다.** `toBe(5)` 단언을 고치지 마라.

```ts
// 178행은 그대로 둔다
expect(oneProjectQueryCount).toBe(5);
expect(tenProjectQueryCount).toBe(oneProjectQueryCount);

// 새 테스트
it('구성요소별 관측을 함께 낸다', async () => {
  const [project] = await listProjectsWithSummaryData(db);
  const web = project!.components.find((c) => c.slug === 'web');
  expect(project!.componentObservations.get(web!.id)).toEqual({
    name: 'deployhub-web',
    state: 'running',
  });
});

it('관측이 없는 구성요소는 키가 없다', async () => {
  const [project] = await listProjectsWithSummaryData(db);
  const worker = project!.components.find((c) => c.slug === 'worker');
  expect(project!.componentObservations.has(worker!.id)).toBe(false);
});
```

**관측이 없으면 키를 넣지 마라.** `null` 을 넣으면 화면에서 "관측 없음" 과 "구성요소 없음" 을 구분하기 어려워진다.

- [ ] **Step 2: 실패 확인 → 조회 구현**

기존 `linkedResourceRows` 조회의 `select` 에 세 열을 더한다.

```ts
.select({
  projectId: components.projectId,
  provider: resources.provider,
  componentId: componentResources.componentId,
  resourceName: resources.name,
  resourceStatus: resources.status,
})
```

`where` 에 `ne(componentResources.linkedBy, 'suggested')` 를 더한다. 추정 링크는
관측이 아니다. `drift.ts` 와 `resources.ts` 가 이미 같은 규칙을 쓴다.

**`provider` 집계가 깨지지 않게 조심해라.** 지금 이 조회의 결과로
`observedProviders` 를 만든다. 열을 더해도 행 수는 같지만, `suggested` 를 빼면
provider 집합이 달라질 수 있다. 기존 테스트가 그것을 잡는지 확인하고, 안 잡으면
그대로 두지 말고 보고해라.

한 자원이 여러 구성요소에 연결될 수 있다. `componentId` 로 묶을 때 **가장
먼저 오는 하나**만 쓰되, 정렬을 명시해 결과가 실행마다 달라지지 않게 해라.
`ORDER BY` 없는 조회의 행 순서는 보장되지 않는다.

**프로젝트마다 조회하지 마라.** 조회 수가 5회로 고정돼야 하고, 프로젝트가 1개일
때와 10개일 때 같아야 한다.

- [ ] **Step 3: 실패하는 화면 테스트 작성**

`apps/web/src/components/schematic/project-sheet.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SHEET = readFileSync(
  join(process.cwd(), 'src/components/schematic/project-sheet.tsx'),
  'utf8',
);
const ROOT = readFileSync(join(process.cwd(), 'src/app/page.tsx'), 'utf8');

describe('project sheet', () => {
  it('uses Annotation for observed values', () => {
    expect(SHEET).toContain('<Annotation');
  });

  it('draws the structure with connector characters', () => {
    expect(SHEET).toMatch(/[└├─┬]/);
  });

  it('renders inside a Sheet', () => {
    expect(SHEET).toContain('<Sheet');
  });
});

describe('root screen', () => {
  it('no longer renders a table', () => {
    expect(ROOT).not.toContain('<Table');
    expect(ROOT).not.toContain('<TableHead');
  });

  it('links to the discovered screen without listing stacks', () => {
    expect(ROOT).toContain('/discovered');
    expect(ROOT).not.toContain('listDiscoveredStacks');
  });

  it('computes relative time once on the server', () => {
    expect(ROOT).toContain('formatRelativeTime');
    expect(ROOT).not.toContain("'use client'");
  });
});
```

- [ ] **Step 4: 실패 확인 → 화면 구현**

`project-sheet.tsx` 가 프로젝트 하나를 그린다.

```
 ● DeployHub                        2시간 전
 ──────────────────────────────────────────
  github  gnghkim/DeployHub
     └─┬ VPS Docker
       ├ web       ┆ deployhub-web · running
       ├ worker    ┆ —
       └ database  ┆ deployhub-postgres · healthy
```

위계:

1. 판정 점 + 프로젝트 이름 — 산세, 15px, `--line`
2. 저장소·배포처 — 모노, 13px, `--line-mute`
3. 구성요소 이름 — 모노, 13px, `--line`
4. 관측 — `Annotation` 이 알아서 한다
5. 시각 — 우측, `--absent`, `formatRelativeTime` 을 서버에서 한 번

**연결 문자(`└ ├ ─ ┬`)는 `aria-hidden` 이다.** 스크린리더에 트리 그림이 읽히면 소음이다. 구조는 중첩 `<ul>` 로 표현한다.

`page.tsx` 에서 표를 걷어내고 `project-sheet` 목록으로 바꾼다. 마지막에 한 줄:

```tsx
<p className="text-sm text-[var(--annotation)]">
  등록되지 않은 스택 {discoveredCount} →{' '}
  <Link href="/discovered" className="text-[var(--line)] hover:underline">발견</Link>
</p>
```

**개수만 가져온다.** 스택 목록을 루트에서 조회하지 마라.

**도메인 줄은 데이터가 있을 때만 그린다.** 지금 운영에는 `domains` 가 0행이고 `components.url` 이 전부 null 이다. 없을 때 도면이 무너지면 안 된다.

- [ ] **Step 5: 통과 확인과 커밋**

```bash
pnpm typecheck
pnpm test
pnpm --filter web build
```

**게이트 통과 조건:** 조회 수가 프로젝트 수와 무관할 것. 표가 사라졌을 것. 미등록 스택이 개수 한 줄일 것. 관측 없는 구성요소가 `—` 일 것. 도메인 0행에서 렌더될 것.

---

## Task 4: 프로젝트 상세

**Files:**
- Modify: `apps/web/src/app/projects/[slug]/composition.tsx`
- Modify: `apps/web/src/app/projects/[slug]/page.tsx`
- Test: `apps/web/src/app/projects/[slug]/page.test.ts` (확장)

**Interfaces:**
- Consumes: Task 2 의 `Sheet`, `Annotation`, `Badge`. Task 3 의 트리 표기 관례.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
it('구성도가 Annotation 으로 관측을 그린다', () => {
  const composition = readFileSync(
    join(process.cwd(), 'src/app/projects/[slug]/composition.tsx'), 'utf8');
  expect(composition).toContain('<Annotation');
});

it('구성도의 관측 자리를 판정이 덮지 않는다', () => {
  const composition = readFileSync(
    join(process.cwd(), 'src/app/projects/[slug]/composition.tsx'), 'utf8');
  expect(composition).not.toContain('judgeStatus');
  expect(composition).not.toContain('ProjectStatus');
});

it('Drift 에 경고색을 쓰지 않는다', () => {
  const page = readFileSync(
    join(process.cwd(), 'src/app/projects/[slug]/page.tsx'), 'utf8');
  const driftBlock = page.slice(page.indexOf('DRIFT_LABELS'));
  expect(driftBlock).not.toContain("tone={conflict ? 'fault' : 'caution'}");
});
```

두 번째가 중요하다. **관측은 사실이고 판정은 해석이라 자리가 다르다.** 이 구분이 시스템 전체의 토대다.

- [ ] **Step 2: 실패 확인 → 구현**

`composition.tsx` 의 3열 그리드(`선언 | → | 관측`)를 `Annotation` 으로 바꾼다. 화살표 대신 `┆` 다.

`md` 미만에서 세로로 쌓는 지금 동작을 유지한다. 쌓여도 `┆` 와 `관측` 라벨로 구분이 남아야 한다.

`Sheet` 로 감싸 격자를 준다.

`page.tsx`:

- 맨 위 한 줄: `production · 중요도 4 · gnghkim` + 판정 배지
- 구성도
- 그 아래 판정 근거 (M3 가 만든 것)
- 그 아래 변경 이력 (M3 가 만든 것)
- Drift 는 배지 색 대신 `≠` 기호로. `Badge` 를 쓰되 `tone="neutral"`

- [ ] **Step 3: 검증과 커밋**

```bash
pnpm typecheck && pnpm test && pnpm --filter web build
```

**게이트 통과 조건:** 관측 자리에 판정이 없을 것. Drift 에 경고색이 없을 것. `md` 미만에서 선언·관측 구분이 남을 것.

---

## Task 5: 발견과 타임라인

**Files:**
- Modify: `apps/web/src/app/discovered/page.tsx`
- Modify: `apps/web/src/app/events/page.tsx`
- Modify: `apps/web/src/components/events/timeline-list.tsx`
- Test: `apps/web/src/app/discovered/page.test.ts` (확장), `apps/web/src/app/events/page.test.ts` (확장)

**Interfaces:**
- Consumes: Task 2 의 `Sheet`, `Annotation`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// discovered/page.test.ts 에 더한다
it('선언이 없는 관측으로 그린다', () => {
  expect(page).toContain('<Annotation');
});

it('경고색을 쓰지 않는다', () => {
  expect(page).not.toContain('var(--fault)');
  expect(page).not.toContain('var(--caution)');
  expect(page).not.toContain("tone=\"fault\"");
  expect(page).not.toContain("tone=\"caution\"");
});

it('등록 버튼을 만들지 않는다', () => {
  expect(page).not.toContain('등록하기');
  expect(page).not.toContain('registerStack');
});

// events/page.test.ts 에 더한다
it('info 에 색을 주지 않는다', () => {
  const list = readFileSync(
    join(process.cwd(), 'src/components/events/timeline-list.tsx'), 'utf8');
  expect(list).toMatch(/info:\s*'text-\[var\(--annotation\)\]'/);
});

it('값을 모노로 렌더한다', () => {
  const list = readFileSync(
    join(process.cwd(), 'src/components/events/timeline-list.tsx'), 'utf8');
  expect(list).toContain('font-mono');
});
```

- [ ] **Step 2: 실패 확인 → 구현**

`discovered/page.tsx` — 좌측을 비우고 우측만 있는 도면.

```
  (선언 없음)  ┆ workwiki-backend · running
  (선언 없음)  ┆ workwiki-postgres · running
```

`(선언 없음)` 은 `--absent` 다. 그 모양 자체가 "주인이 없다" 를 말한다. 등록 안내문은 유지하고 등록 버튼은 만들지 않는다.

`timeline-list.tsx` — `이전 → 현재` 가 이미 주기 형태다. 값에 `font-mono` 를 주고 `info` 를 `--annotation` 으로 낮춘다. `최초 관측` 표기는 그대로 둔다.

- [ ] **Step 3: 검증과 커밋**

```bash
pnpm typecheck && pnpm test && pnpm --filter web build
```

**게이트 통과 조건:** 발견 화면에 경고색이 없을 것. 등록 버튼이 없을 것. `info` 에 색이 없을 것.

---

## 최종 검증 — 카드 5 병합 후

Task 5 를 병합한 뒤 사람이 한 번 더 확인한다.

```bash
pnpm typecheck                              # 7개 패키지
pnpm test                                   # 전체
pnpm --filter web build
git grep -n -- "--color-" -- apps/web/src   # 0건
git grep -n "@font-face\|next/font" -- apps # 0건
```

앱을 띄우고 아래가 404·500 없이 응답하는지 확인한다.

```
/  /discovered  /events  /settings
/settings/resources  /settings/providers  /settings/drafts  /settings/tokens
/projects/deployhub
```

**모바일을 실제로 확인한다.** 트리 구조는 들여쓰기 때문에 좁은 화면에서 넘치기 쉽다. 375px 에서 도면이 가로 스크롤 없이 읽혀야 한다.

---

## Self-Review

**1. 스펙 커버리지**

| 스펙 절 | Task |
|---|---|
| 3. `┆` 규칙 | 2 (`Annotation`), 3·4·5 (적용) |
| 4. 토큰 | 1 |
| 5. 그리드 | 1 (`.sheet`), 2 (`Sheet`) |
| 6. 타이포 | 1 (토큰), 2~5 (적용) |
| 7.1 루트 | 3 |
| 7.2 상세 | 4 |
| 7.3 발견 | 5 |
| 7.4 타임라인 | 5 |
| 8. `DESIGN.md` | 1 |
| 9. 검증 | 각 Task + 최종 검증 |

**2. 타입 일관성**

- `Tone` — Task 2 정의, Task 3·4·5 가 소비 ✓
- `Sheet`·`Annotation` — Task 2 정의, Task 3·4·5 가 소비 ✓
- `componentObservations` — Task 3 정의, Task 3 만 사용 ✓
- M3 의 `judgeStatus`·`ProjectStatus`·`listTimelineEvents` — 변경 없이 읽기만 ✓
- `computeDrift` — 변경 없이 읽기만 ✓

**3. 위험 지점**

- **토큰 치환은 깨져도 테스트가 안 잡는다.** 화면이 렌더되기만 하면 색이 틀려도 통과한다. Task 1 의 `design-tokens.test.ts` 가 유일한 방어다.
- **표면 3단계를 2단계로 접으면 경계가 사라지는 곳이 생긴다.** 배경으로 구분하던 자리를 선으로 바꿔야 한다. 새 배경색을 만드는 것으로 도망가기 쉽다.
- **포커스 링을 잃기 쉽다.** `--color-info` 를 "상태 색이니 지우자" 로 오해하면 접근성이 깨진다. 이름을 `--accent` 로 바꾼 이유가 이것이다.
- **연결 문자가 스크린리더에 읽힌다.** `aria-hidden` 을 빠뜨리면 트리 그림이 그대로 낭독된다.
- **루트에서 N+1 이 생기기 쉽다.** 구성요소별 관측을 그리려면 컨테이너 이름이 필요하고, 가장 쉬운 구현이 프로젝트마다 조회하는 것이다.
- **모바일에서 트리가 넘친다.** 들여쓰기 + 모노 + 긴 컨테이너 이름이 겹친다.
