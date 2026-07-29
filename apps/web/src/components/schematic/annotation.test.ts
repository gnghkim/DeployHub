import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ANNOTATION = readFileSync(
  join(SOURCE_DIR, 'components/schematic/annotation.tsx'),
  'utf8',
);
const BADGE = readFileSync(
  join(SOURCE_DIR, 'components/ui/badge.tsx'),
  'utf8',
);
const ROOT = readFileSync(join(SOURCE_DIR, 'app/page.tsx'), 'utf8');

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
