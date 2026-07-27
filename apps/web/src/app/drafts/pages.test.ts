import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = (relativePath: string) => readFileSync(
  fileURLToPath(new URL(relativePath, import.meta.url)),
  'utf8',
);

describe('Draft review screens', () => {
  it('renders both list and detail pages as server components', () => {
    expect(source('./page.tsx')).not.toContain("'use client'");
    expect(source('./[id]/page.tsx')).not.toContain("'use client'");
  });

  it('shows omitted components and highlights uncertain field sources', () => {
    const detail = source('./[id]/page.tsx');

    expect(detail).toContain('manifest에 없음');
    expect(detail).toContain('inferred');
    expect(detail).toContain('unknown');
  });

  it('shows component deployment declarations during review', () => {
    const detail = source('./[id]/page.tsx');

    expect(detail).toContain('component.provider');
    expect(detail).toContain('component.externalRef');
    expect(detail).toContain('component.container');
  });

  it('provides approve and reject forms', () => {
    const detail = source('./[id]/page.tsx');

    expect(detail).toContain('approveDraft');
    expect(detail).toContain('rejectDraft');
    expect(detail).toContain('승인');
    expect(detail).toContain('거부');
  });
});
