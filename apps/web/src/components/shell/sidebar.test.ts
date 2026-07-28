import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./sidebar.tsx', import.meta.url)),
  'utf8',
);
const shellPath = fileURLToPath(
  new URL('./sidebar-shell.tsx', import.meta.url),
);
const shellSource = existsSync(shellPath)
  ? readFileSync(shellPath, 'utf8')
  : '';

it('keeps only the three everyday top-level navigation items', () => {
  expect(shellSource).toContain("{ label: '프로젝트', href: '/' }");
  expect(shellSource).toContain("{ label: '발견', href: '/discovered' }");
  expect(shellSource).toContain("{ label: '설정', href: '/settings' }");
  expect(shellSource).not.toContain("href: '/projects'");
  expect(shellSource).not.toContain("href: '/providers'");
  expect(shellSource).not.toContain("href: '/resources'");
  expect(shellSource).not.toContain("href: '/drafts'");
  expect(shellSource).not.toContain("href: '/settings/tokens'");
});

it('shows only the pending review Draft count beside 설정', () => {
  expect(source).toContain(
    "listDrafts(db, { status: 'pending_review' })",
  );
  expect(source).toContain(
    '<SidebarShell pendingDraftCount={pendingDrafts.length} />',
  );
  expect(source).not.toContain('validation_failed');
});

it('waits for a request before querying the Draft count', () => {
  expect(source).toContain("import { connection } from 'next/server'");
  expect(source.indexOf('await connection()')).toBeLessThan(
    source.indexOf("listDrafts(db, { status: 'pending_review' })"),
  );
});

it('keeps database access in the server component', () => {
  expect(existsSync(shellPath)).toBe(true);
  expect(source).not.toContain("'use client'");
  expect(shellSource).toContain("'use client'");
  expect(shellSource).not.toContain('@deployhub/db');
  expect(shellSource).not.toContain("from '@/lib/db'");
  expect(shellSource).not.toContain('listDrafts');
});

it('uses a mobile drawer while preserving the desktop sidebar', () => {
  expect(shellSource).toContain('md:hidden');
  expect(shellSource).toContain('md:sticky');
  expect(shellSource).toContain('md:translate-x-0');
  expect(shellSource).toContain('aria-expanded={open}');
  expect(shellSource).toContain('aria-label={open');
  expect(shellSource).toContain('aria-controls="primary-navigation"');
});

it('closes the drawer after navigation, Escape, and backdrop clicks', () => {
  expect(shellSource).toContain('usePathname');
  expect(shellSource).toContain('[pathname]');
  expect(shellSource).toContain("event.key === 'Escape'");
  expect(shellSource).toContain('onClick={() => setOpen(false)}');
  expect(shellSource).toContain('aria-label="내비게이션 배경 닫기"');
});

it('locks background scrolling only while the drawer is open', () => {
  expect(shellSource).toContain("document.body.style.overflow = 'hidden'");
  expect(shellSource).toContain('document.body.style.overflow = previousOverflow');
  expect(shellSource).toContain('[open]');
});
