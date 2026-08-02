import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = join(HERE, '..', '..');
const GLOBALS = join(HERE, 'globals.css');
const SELF = 'design-tokens.test.ts';

type Rgb = [number, number, number];

function parseHexToken(css: string, token: string): Rgb {
  const match = css.match(new RegExp(`${token}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!match) throw new Error(`Missing six-digit hex value for ${token}`);

  const value = match[1];
  if (!value) throw new Error(`Missing six-digit hex value for ${token}`);
  return [
    Number.parseInt(value.slice(1, 3), 16),
    Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16),
  ];
}

function relativeLuminance(rgb: Rgb): number {
  const toLinear = (channel: number): number => {
    const srgb = channel / 255;
    return srgb <= 0.04045
      ? srgb / 12.92
      : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  const [red, green, blue] = rgb.map(toLinear) as Rgb;

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: Rgb, background: Rgb): number {
  const lighter = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  const darker = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  return (lighter + 0.05) / (darker + 0.05);
}

function composite(foreground: Rgb, background: Rgb, alpha: number): Rgb {
  return foreground.map(
    (channel, index) => channel * alpha + background[index]! * (1 - alpha),
  ) as Rgb;
}

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

  it.each(['--annotation', '--absent'])(
    '%s meets WCAG AA contrast on normal and hovered project card surfaces',
    (token) => {
      const css = readFileSync(GLOBALS, 'utf8');
      const foreground = parseHexToken(css, token);
      const paper = parseHexToken(css, '--paper');
      const grid = parseHexToken(css, '--grid');
      const canvas = parseHexToken(css, '--canvas');
      const hoverNonGrid = composite([255, 255, 255], canvas, 0.02);

      const surfaces: Array<[string, Rgb]> = [
        ['--paper', paper],
        ['--grid', grid],
        ['project-card hover non-grid', hoverNonGrid],
        ['--grid on project-card hover', grid],
      ];

      for (const [surface, background] of surfaces) {
        expect(
          contrastRatio(foreground, background),
          `${token} on ${surface}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});
