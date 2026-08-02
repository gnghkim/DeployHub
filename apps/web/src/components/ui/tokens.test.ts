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
  '--canvas': '#030406',
  '--paper': '#111316',
  '--grid': '#1d2024',
  '--rule': '#2b2f33',
  '--line': '#f8f9fa',
  '--line-mute': '#9ca3af',
  '--annotation': '#8b949e',
  '--absent': '#7c8590',
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
    expect(projectDetail).toContain("tone={conflict ? 'fault' : 'neutral'}");
    expect(projectDetail).not.toContain("tone={conflict ? 'fault' : 'caution'}");
  });

  it('caps the topbar type scale at 20px', () => {
    expect(topbar).not.toMatch(/\btext-(?:2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)\b/);
  });
});
