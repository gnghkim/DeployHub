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
