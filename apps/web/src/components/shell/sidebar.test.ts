import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('links to Draft review and registration token settings', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./sidebar.tsx', import.meta.url)),
    'utf8',
  );

  expect(source).toContain("href: '/drafts'");
  expect(source).toContain("href: '/settings/tokens'");
});

it('uses the root project list as the only overview navigation item', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./sidebar.tsx', import.meta.url)),
    'utf8',
  );

  expect(source).toContain("{ label: '프로젝트', href: '/' }");
  expect(source).not.toContain("{ label: 'Overview'");
  expect(source).not.toContain("{ label: 'Projects'");
  expect(source).not.toContain("href: '/projects'");
});

it('places 발견 immediately after 프로젝트 without changing other navigation items', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./sidebar.tsx', import.meta.url)),
    'utf8',
  );

  expect(source).toMatch(
    /\{ label: '프로젝트', href: '\/' \},\r?\n  \{ label: '발견', href: '\/discovered' \},/,
  );
  expect(source).toContain("{ label: 'Providers', href: '/providers' }");
  expect(source).toContain("{ label: 'Resources', href: '/resources' }");
  expect(source).toContain("{ label: 'Drafts', href: '/drafts' }");
  expect(source).toContain(
    "{ label: 'Registration tokens', href: '/settings/tokens' }",
  );
});
