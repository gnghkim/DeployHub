import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('각 provider 토큰 입력란에 저장한 값을 되비추는 속성이 없다', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../settings/providers/page.tsx', import.meta.url)),
    'utf8',
  );
  const tokenInputs = source.match(
    /<Input[\s\S]*?name="token"[\s\S]*?\/>/g,
  ) ?? [];

  expect(tokenInputs).toHaveLength(3);
  for (const tokenInput of tokenInputs) {
    expect(tokenInput).toContain('type="password"');
    expect(tokenInput).not.toMatch(/(?:defaultValue|value)=/);
  }
});

it('uses measured typography for verification and synchronization times', () => {
  const source = readFileSync(
    fileURLToPath(new URL(
      '../settings/providers/components/provider-account-card.tsx',
      import.meta.url,
    )),
    'utf8',
  );

  expect(source).toMatch(
    /<dd className="font-mono text-\[var\(--line-mute\)\]">\s*\{lastVerifiedAt/,
  );
  expect(source).toMatch(
    /<dd className="font-mono text-\[var\(--line-mute\)\]">\s*\{lastSyncAt/,
  );
});
