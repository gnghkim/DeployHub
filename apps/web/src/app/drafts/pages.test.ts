import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = (relativePath: string) => readFileSync(
  fileURLToPath(new URL(relativePath, import.meta.url)),
  'utf8',
);

describe('Draft review screens', () => {
  it('renders both list and detail pages as server components', () => {
    expect(source('../settings/drafts/page.tsx')).not.toContain("'use client'");
    expect(source('../settings/drafts/[id]/page.tsx')).not.toContain("'use client'");
  });

  it('shows omitted components and highlights uncertain field sources', () => {
    const detail = source('../settings/drafts/[id]/page.tsx');

    expect(detail).toContain('manifest에 없음');
    expect(detail).toContain('inferred');
    expect(detail).toContain('unknown');
  });

  it('shows component deployment declarations during review', () => {
    const detail = source('../settings/drafts/[id]/page.tsx');

    expect(detail).toContain('component.provider');
    expect(detail).toContain('component.externalRef');
    expect(detail).toContain('component.container');
  });

  it('provides approve and reject forms', () => {
    const detail = source('../settings/drafts/[id]/page.tsx');

    expect(detail).toContain('approveDraft');
    expect(detail).toContain('rejectDraft');
    expect(detail).toContain('승인');
    expect(detail).toContain('거부');
  });

  it('uses measured typography for draft identifiers and submission times', () => {
    const list = source('../settings/drafts/page.tsx');

    expect(list).toContain(
      'className="font-mono font-medium text-[var(--line)] hover:underline"',
    );
    expect(list).toContain(
      "import { formatDateTime } from '../../../lib/datetime';",
    );
    expect(list).toContain(
      '<TableCell className="font-mono">{formatDateTime(draft.createdAt)}</TableCell>',
    );
  });

  it('uses measured typography only for technical project diff fields', () => {
    const detail = source('../settings/drafts/[id]/page.tsx');

    expect(detail).toMatch(
      /const MONO_PROJECT_FIELDS = new Set\(\[\s*'slug',\s*'lifecycle',\s*'importance',\s*'repository',\s*\]\)/,
    );
    expect(detail).toContain('MONO_PROJECT_FIELDS.has(change.field)');
    expect(detail).not.toContain(
      '<li key={change.field} className="font-mono">',
    );
  });
});
