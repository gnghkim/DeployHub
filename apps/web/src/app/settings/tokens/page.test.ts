import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = (relativePath: string) => readFileSync(
  fileURLToPath(new URL(relativePath, import.meta.url)),
  'utf8',
);

describe('registration token settings screen', () => {
  it('keeps the page server-rendered and limits client code to the form', () => {
    expect(source('./page.tsx')).not.toContain("'use client'");
    expect(source('./token-form.tsx')).toContain("'use client'");
  });

  it('shows the returned raw token with a one-time warning', () => {
    const form = source('./token-form.tsx');

    expect(form).toContain('rawToken');
    expect(form).toContain('한 번만');
  });
});
