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
