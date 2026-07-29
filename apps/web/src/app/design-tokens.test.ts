import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, '..', '..');
const GLOBALS = join(HERE, 'globals.css');
const SELF = 'design-tokens.test.ts';

function allSourceText(): string {
  const listed = execFileSync(
    'git',
    ['ls-files', 'src'],
    { cwd: WEB_ROOT, encoding: 'utf8' },
  );
  return listed
    .split('\n')
    .filter((file) => /\.(tsx?|css)$/.test(file) && !file.endsWith(SELF))
    .map((file) => readFileSync(join(WEB_ROOT, file), 'utf8'))
    .join('\n');
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
      expect(css.split(`${token}:`).length - 1, `${token} definition count`).toBe(1);
    }
  });

  it('has no retired token left anywhere in the app', () => {
    const text = allSourceText();
    for (const token of RETIRED) {
      expect(text.includes(token), `${token} should be gone`).toBe(false);
    }
  });

  it('loads no web font', () => {
    const text = allSourceText();
    for (const marker of ['@font-face', 'fonts.googleapis.com', 'fonts.gstatic.com', 'next/font']) {
      expect(text.includes(marker), `${marker} should be absent`).toBe(false);
    }
  });

  it('caps the type scale at 20px', () => {
    const css = readFileSync(GLOBALS, 'utf8');
    expect(css.includes('64px')).toBe(false);
    expect(css.includes('56px')).toBe(false);
  });
});
