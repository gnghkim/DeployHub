import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('토큰 입력란에 저장한 값을 되비추는 속성이 없다', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../settings/providers/page.tsx', import.meta.url)),
    'utf8',
  );
  const tokenInput = source.match(
    /<Input[\s\S]*?name="token"[\s\S]*?\/>/,
  )?.[0];

  expect(tokenInput).toContain('type="password"');
  expect(tokenInput).not.toMatch(/(?:defaultValue|value)=/);
});

it('uses measured typography for verification and synchronization times', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../settings/providers/page.tsx', import.meta.url)),
    'utf8',
  );

  expect(source).toMatch(
    /<dd className="font-mono text-\[var\(--line-mute\)\]">\s*\{account\.lastVerifiedAt/,
  );
  expect(source).toMatch(
    /<dd className="font-mono text-\[var\(--line-mute\)\]">\s*\{account\.lastSyncAt/,
  );
});
