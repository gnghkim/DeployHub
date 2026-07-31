import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ProviderAccountCard } from './components/provider-account-card';

it('renders account metadata and only the token suffix', () => {
  const plaintextToken = 'vercel_plaintext_secret_1234';
  const markup = renderToStaticMarkup(createElement(ProviderAccountCard, {
    id: 'account-1',
    name: 'acme-team',
    tokenSuffix: plaintextToken.slice(-4),
    lastVerifiedAt: new Date('2026-07-30T01:00:00.000Z'),
    lastSyncAt: null,
    lastError: '동기화 실패',
    syncAction: async () => undefined,
  }));

  expect(markup).toContain('acme-team');
  expect(markup).toContain('••••1234');
  expect(markup).toContain('마지막 확인');
  expect(markup).toContain('마지막 동기화');
  expect(markup).toContain('동기화 실패');
  expect(markup).toContain('name="accountId"');
  expect(markup).toContain('value="account-1"');
  expect(markup).toContain('지금 동기화');
  expect(markup).not.toContain(plaintextToken);
});
