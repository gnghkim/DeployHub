import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd().endsWith(join('apps', 'web'))
  ? process.cwd()
  : join(process.cwd(), 'apps', 'web');
const SHEET = readFileSync(
  join(PROJECT_ROOT, 'src/components/schematic/project-sheet.tsx'),
  'utf8',
);
const SHARED_SHEET = readFileSync(
  join(PROJECT_ROOT, 'src/components/schematic/sheet.tsx'),
  'utf8',
);
const ROOT = readFileSync(join(PROJECT_ROOT, 'src/app/page.tsx'), 'utf8');

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

  it('scopes hover and focus interaction styles to project cards', () => {
    expect(SHARED_SHEET).not.toMatch(/hover:(?:border|bg)-/);
    expect(SHARED_SHEET).not.toContain('focus-within:');
    expect(SHARED_SHEET).not.toContain('shadow-');
    expect(SHARED_SHEET).not.toMatch(/\b(?:transition|duration)-/);
    expect(SHEET).toContain('hover:border-[var(--annotation)]');
    expect(SHEET).toContain('hover:bg-white/[0.02]');
    expect(SHEET).toContain('focus-within:border-[var(--annotation)]');
    expect(SHEET).toContain('focus-within:bg-white/[0.02]');
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
