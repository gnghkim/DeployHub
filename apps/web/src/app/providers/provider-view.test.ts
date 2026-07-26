import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { encrypt } from '@deployhub/shared';
import { storedTokenSuffix } from './provider-view';

it('복호화한 토큰에서 마지막 4자리만 반환한다', () => {
  const key = randomBytes(32);
  const token = 'github_pat_screenSecret';

  const suffix = storedTokenSuffix(encrypt(token, key), key);

  expect(suffix).toBe('cret');
  expect(suffix).not.toContain(token);
});
