import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8');
const projectDetail = readFileSync(
  new URL('../../app/projects/[slug]/page.tsx', import.meta.url),
  'utf8',
);
const topbar = readFileSync(
  new URL('../shell/topbar.tsx', import.meta.url),
  'utf8',
);

const REQUIRED: Record<string, string> = {
  '--canvas': '#07080a',
  '--paper': '#0d0d0d',
  '--grid': '#16181a',
  '--rule': '#242728',
  '--line': '#f4f4f6',
  '--line-mute': '#cdcdcd',
  '--annotation': '#9c9c9d',
  '--absent': '#6a6b6c',
  '--fault': '#ff6161',
  '--caution': '#ffc533',
  '--confirm': '#59d499',
  '--accent': '#57c1ff',
};

describe('DeployHub design tokens', () => {
  for (const [name, value] of Object.entries(REQUIRED)) {
    it(`defines ${name} as ${value}`, () => {
      expect(css).toMatch(new RegExp(`${name}:\\s+${value};`));
    });
  }

  it('does not use shadows', () => {
    expect(css).not.toMatch(/box-shadow:\s*(?!none)/);
  });

  it('keeps drift neutral unless a conflict is a fault', () => {
    expect(projectDetail).toContain("tone={conflict ? 'error' : 'neutral'}");
    expect(projectDetail).not.toContain("tone={conflict ? 'error' : 'warning'}");
  });

  it('caps the topbar type scale at 20px', () => {
    expect(topbar).not.toMatch(/\btext-(?:2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b/);
  });
});
