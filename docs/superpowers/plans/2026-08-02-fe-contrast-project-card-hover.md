# FE Contrast and Project Card Hover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the user's darker FE refresh while restoring WCAG AA support-text contrast and limiting interactive hover treatment to project cards.

**Architecture:** Keep the global palette in `globals.css`, but raise the two support-text tokens to approved accessible values. Restore the shared `Sheet` as a static surface and place hover/focus treatment at the `ProjectSheet` call site, where the interaction belongs; protect both decisions with focused contrast and render/source contract tests.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, Tailwind CSS 4, Vitest, happy-dom

---

## File map

- Modify: `apps/web/src/app/globals.css` — apply the approved support-text colors while retaining the user's other palette changes.
- Modify: `apps/web/src/app/design-tokens.test.ts` — calculate real WCAG contrast ratios for paper and the 2% white hover composite.
- Modify: `apps/web/src/components/schematic/project-sheet.tsx` — scope card hover/focus styling and restore link affordance.
- Modify: `apps/web/src/components/schematic/project-sheet.test.ts` — protect the shared `Sheet` boundary and project-only styling.
- Modify: `apps/web/src/components/schematic/project-sheet-render.test.ts` — verify rendered hover and keyboard-focus classes on the project link/card.
- Modify: `apps/web/src/components/schematic/sheet.tsx` — remove interactive styling from the shared static surface.

### Task 1: Accessible support colors and project-only interaction

**Files:**
- Modify: `apps/web/src/app/design-tokens.test.ts`
- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/components/schematic/project-sheet.test.ts`
- Modify: `apps/web/src/components/schematic/project-sheet-render.test.ts`
- Modify: `apps/web/src/components/schematic/project-sheet.tsx`
- Modify: `apps/web/src/components/schematic/sheet.tsx`

- [ ] **Step 1: Add a failing WCAG contrast test**

In `apps/web/src/app/design-tokens.test.ts`, add these helpers after the token arrays:

```ts
type Rgb = { r: number; g: number; b: number };

function tokenHex(css: string, token: string): string {
  const match = css.match(new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match?.[1]) throw new Error(`Missing hex token ${token}`);
  return match[1];
}

function rgb(hex: string): Rgb {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function blend(foreground: Rgb, background: Rgb, alpha: number): Rgb {
  return {
    r: foreground.r * alpha + background.r * (1 - alpha),
    g: foreground.g * alpha + background.g * (1 - alpha),
    b: foreground.b * alpha + background.b * (1 - alpha),
  };
}

function luminance(color: Rgb): number {
  const channels = [color.r, color.g, color.b].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(foreground: Rgb, background: Rgb): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}
```

Add this test inside `describe('design tokens', ...)`:

```ts
  it('keeps support text at WCAG AA contrast on paper and card hover', () => {
    const css = readFileSync(GLOBALS, 'utf8');
    const paper = rgb(tokenHex(css, '--paper'));
    const hover = blend({ r: 255, g: 255, b: 255 }, paper, 0.02);

    for (const token of ['--annotation', '--absent']) {
      const foreground = rgb(tokenHex(css, token));
      expect(contrast(foreground, paper), `${token} on paper`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(foreground, hover), `${token} on hover`).toBeGreaterThanOrEqual(4.5);
    }
  });
```

- [ ] **Step 2: Run the contrast test and verify RED**

Run:

```bash
pnpm --filter web exec vitest run src/app/design-tokens.test.ts
```

Expected: FAIL for the current `--annotation: #6b7280` and `--absent: #4b5563` contrast ratios.

- [ ] **Step 3: Add failing project-card interaction scope tests**

In `apps/web/src/components/schematic/project-sheet.test.ts`, read the shared component:

```ts
const SHARED_SHEET = readFileSync(
  join(PROJECT_ROOT, 'src/components/schematic/sheet.tsx'),
  'utf8',
);
```

Add these tests inside `describe('project sheet', ...)`:

```ts
  it('keeps hover and focus treatment on project cards, not every Sheet', () => {
    expect(SHARED_SHEET).not.toContain('hover:border-');
    expect(SHARED_SHEET).not.toContain('hover:bg-');
    expect(SHEET).toContain('hover:border-[var(--annotation)]');
    expect(SHEET).toContain('hover:bg-white/[0.02]');
    expect(SHEET).toContain('focus-within:border-[var(--annotation)]');
    expect(SHEET).toContain('focus-within:bg-white/[0.02]');
  });
```

In the first test of `project-sheet-render.test.ts`, after locating `projectLink`, add:

```ts
    expect(projectLink.className).toContain('hover:underline');
    expect(projectLink.className).toContain('focus-visible:underline');
    expect(projectLink.className).toContain('focus-visible:outline-2');
```

- [ ] **Step 4: Run the project-sheet tests and verify RED**

Run:

```bash
pnpm --filter web exec vitest run src/components/schematic/project-sheet.test.ts src/components/schematic/project-sheet-render.test.ts
```

Expected: FAIL because the shared `Sheet` still owns the hover styles and the project link has no underline/focus classes.

- [ ] **Step 5: Apply the approved support colors**

In `apps/web/src/app/globals.css`, replace only these two token values:

```css
  --annotation:  #8b949e;
  --absent:      #7c8590;
```

Keep the user's current values for `--canvas`, `--paper`, `--grid`, `--rule`, `--line`, and `--line-mute` unchanged.

- [ ] **Step 6: Restore the shared `Sheet` boundary**

In `apps/web/src/components/schematic/sheet.tsx`, restore the static class list:

```tsx
    <section
      className={`sheet rounded-[var(--radius-card)] border border-[var(--rule)] p-4 md:p-5 ${className}`}
    >
```

- [ ] **Step 7: Add project-only hover/focus and link affordance**

In `apps/web/src/components/schematic/project-sheet.tsx`, replace the opening `Sheet` with:

```tsx
    <Sheet className="min-w-0 overflow-hidden transition-colors duration-300 hover:border-[var(--annotation)] hover:bg-white/[0.02] focus-within:border-[var(--annotation)] focus-within:bg-white/[0.02] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]">
```

Keep the user's `text-base font-semibold` project-name typography and replace its interaction classes with:

```tsx
className="min-w-0 break-words text-base font-semibold text-[var(--line)] transition-colors hover:text-white hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--line)]"
```

Do not change the existing collapse button, deployment time, component tree, repository, deployment label, or observation rendering.

- [ ] **Step 8: Run focused tests and verify GREEN**

Run:

```bash
pnpm --filter web exec vitest run src/app/design-tokens.test.ts src/components/schematic/project-sheet.test.ts src/components/schematic/project-sheet-render.test.ts src/components/schematic/project-sheet-collapse.test.tsx
```

Expected: all focused tests pass, including the contrast, scope, rendered link, and collapse behavior checks.

- [ ] **Step 9: Commit the implementation**

Run:

```bash
git add apps/web/src/app/globals.css \
  apps/web/src/app/design-tokens.test.ts \
  apps/web/src/components/schematic/project-sheet.tsx \
  apps/web/src/components/schematic/project-sheet.test.ts \
  apps/web/src/components/schematic/project-sheet-render.test.ts \
  apps/web/src/components/schematic/sheet.tsx
git commit -m "fix(web): restore accessible project card styling"
```

Expected: the commit contains the user's FE refresh plus the accessibility and scope corrections, while `.superpowers/` remains untracked.

### Task 2: Full verification

**Files:**
- Verify: all files changed in Task 1

- [ ] **Step 1: Run web type checking**

```bash
pnpm --filter web typecheck
```

Expected: exit 0 with no TypeScript errors.

- [ ] **Step 2: Run the complete web test suite**

```bash
pnpm --filter web exec vitest run
```

Expected: every web test file and test passes.

- [ ] **Step 3: Build the production web application**

```bash
pnpm --filter web build
```

Expected: the production build exits 0. The existing middleware deprecation warning may remain.

- [ ] **Step 4: Verify final contrast numerically**

Run the focused design-token test again and confirm both support tokens pass on paper and the 2% white hover composite:

```bash
pnpm --filter web exec vitest run src/app/design-tokens.test.ts
```

Expected: exit 0; the approved palette produces approximately 6.05:1 for `--annotation` and 4.98:1 for `--absent` on paper, with both remaining at or above 4.5:1 on hover.

- [ ] **Step 5: Inspect scope and cleanliness**

```bash
git diff --check HEAD~1..HEAD
git show --stat --oneline HEAD
git status --short
```

Expected: diff check exits 0; only the six planned FE/test files are in the implementation commit; the visual companion `.superpowers/` directory is the only unrelated untracked path.
