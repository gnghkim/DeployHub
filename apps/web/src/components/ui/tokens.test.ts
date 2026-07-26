import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');

const REQUIRED: Record<string, string> = {
  '--color-canvas': '#07080a',
  '--color-surface': '#0d0d0d',
  '--color-surface-elevated': '#101111',
  '--color-surface-card': '#121212',
  '--color-ink': '#f4f4f6',
  '--color-body': '#cdcdcd',
  '--color-mute': '#9c9c9d',
  '--color-ash': '#6a6b6c',
  '--color-hairline': '#242728',
  '--color-success': '#59d499',
  '--color-warning': '#ffc533',
  '--color-error': '#ff6161',
  '--color-info': '#57c1ff',
};

describe('Raycast design tokens', () => {
  for (const [name, value] of Object.entries(REQUIRED)) {
    it(`defines ${name} as ${value}`, () => {
      expect(css).toContain(`${name}: ${value};`);
    });
  }

  it('does not use shadows', () => {
    expect(css).not.toMatch(/box-shadow:\s*(?!none)/);
  });
});
