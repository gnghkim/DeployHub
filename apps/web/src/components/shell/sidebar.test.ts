import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./sidebar.tsx', import.meta.url)),
  'utf8',
);

it('keeps only the three everyday top-level navigation items', () => {
  expect(source).toContain("{ label: '프로젝트', href: '/' }");
  expect(source).toContain("{ label: '발견', href: '/discovered' }");
  expect(source).toContain("{ label: '설정', href: '/settings' }");
  expect(source).not.toContain("href: '/projects'");
  expect(source).not.toContain("href: '/providers'");
  expect(source).not.toContain("href: '/resources'");
  expect(source).not.toContain("href: '/drafts'");
  expect(source).not.toContain("href: '/settings/tokens'");
});

it('shows only the pending review Draft count beside 설정', () => {
  expect(source).toContain(
    "listDrafts(db, { status: 'pending_review' })",
  );
  expect(source).toContain('{pendingDrafts.length}');
  expect(source).not.toContain('validation_failed');
});

it('waits for a request before querying the Draft count', () => {
  expect(source).toContain("import { connection } from 'next/server'");
  expect(source.indexOf('await connection()')).toBeLessThan(
    source.indexOf("listDrafts(db, { status: 'pending_review' })"),
  );
});
