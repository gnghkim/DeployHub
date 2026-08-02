import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = (relativePath: string) => readFileSync(
  fileURLToPath(new URL(relativePath, import.meta.url)),
  'utf8',
);

const PAGE_PATHS = [
  './page.tsx',
  './discovered/page.tsx',
  './events/page.tsx',
  './projects/new/page.tsx',
  './projects/[slug]/page.tsx',
  './projects/[slug]/edit/page.tsx',
  './projects/[slug]/components/new/page.tsx',
  './settings/page.tsx',
  './settings/drafts/page.tsx',
  './settings/drafts/[id]/page.tsx',
  './settings/providers/page.tsx',
  './settings/resources/page.tsx',
  './settings/tokens/page.tsx',
] as const;

describe('responsive shell spacing', () => {
  it.each(PAGE_PATHS)('%s uses compact mobile main padding', (path) => {
    const page = source(path);

    expect(page).not.toMatch(/(?<!md:)p-8/);
    expect(page).toContain('p-4 md:p-8');
  });

  it('reserves mobile title space for the menu button', () => {
    const topbar = source('../components/shell/topbar.tsx');

    expect(topbar).toContain('px-4');
    expect(topbar).toContain('pl-16');
    expect(topbar).toContain('md:px-8');
    expect(topbar).not.toMatch(/(?<!md:)px-8/);
  });

  it('stacks snapshot previews below information until the desktop breakpoint', () => {
    const projectSheet = source('../components/schematic/project-sheet.tsx');

    expect(projectSheet).toContain('lg:grid-cols-[minmax(0,1fr)_minmax(20rem,42%)]');
    expect(projectSheet).toMatch(/className="[^"]*\bgrid\b[^"]*lg:grid-cols-/);
    expect(projectSheet).not.toContain('grid-cols-[minmax(0,1fr)_minmax(20rem,42%)] lg:');
  });
});
