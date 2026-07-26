import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseManifest } from './parse';

const fixture = (name: string) =>
  readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url), 'utf8');

describe('parseManifest', () => {
  it('parses valid YAML', () => {
    const result = parseManifest(fixture('valid.yaml'));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.metadata.slug).toBe('deployhub');
      expect(result.warnings).toEqual([]);
    }
  });

  it('returns a line-numbered error for invalid YAML syntax', () => {
    const result = parseManifest(fixture('invalid-syntax.yaml'));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]?.message).toMatch(/line \d+/i);
    }
  });

  it('returns a human-readable path for schema violations', () => {
    const result = parseManifest(fixture('invalid-schema.yaml'));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          path: 'spec.components[0].type',
          severity: 'error',
        }),
      );
    }
  });

  it('warns when documents are declared because M1c does not store them', () => {
    const result = parseManifest(`${fixture('valid.yaml')}
  documents:
    - type: readme
      path: README.md
`);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toEqual([
        expect.objectContaining({
          path: 'spec.documents',
          severity: 'warning',
        }),
      ]);
    }
  });

  it('warns when an empty documents list is explicitly declared', () => {
    const result = parseManifest(`${fixture('valid.yaml')}
  documents: []
`);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).toEqual([
        expect.objectContaining({
          path: 'spec.documents',
          severity: 'warning',
        }),
      ]);
    }
  });

  it('returns an error instead of throwing for empty input', () => {
    expect(() => parseManifest('')).not.toThrow();

    const result = parseManifest('');
    expect(result.ok).toBe(false);
  });
});
