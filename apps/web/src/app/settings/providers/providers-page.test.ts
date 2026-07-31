import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

const page = source('./page.tsx');
const accountCard = source('./components/provider-account-card.tsx');

describe('provider settings page', () => {
  it('keeps the page server-rendered and loads accounts for both providers', () => {
    expect(page).not.toContain("'use client'");
    expect(page).toContain('provider: schema.providerAccounts.provider');
    expect(page).not.toMatch(
      /\.where\(\s*eq\(schema\.providerAccounts\.provider,\s*'github'\)\s*\)/,
    );
    expect(page).toContain("account.provider === 'github'");
    expect(page).toContain("account.provider === 'vercel'");
  });

  it('shows GitHub and Vercel sections with their empty states', () => {
    expect(page).toContain('GitHub 연결');
    expect(page).toContain('Vercel 연결');
    expect(page).toContain('연결된 GitHub 계정이 없습니다.');
    expect(page).toContain('연결된 Vercel 계정이 없습니다.');
  });

  it('routes the Vercel connection form and sync cards to Vercel actions', () => {
    expect(page).toContain('saveVercelProvider');
    expect(page).toMatch(/<form action=\{connectVercel\}/);
    expect(page).toContain('name="teamId"');
    expect(page).toContain('개인 계정이면 비워둡니다');
    expect(page).toMatch(
      /vercelAccounts\.map[\s\S]*?<ProviderAccountCard[\s\S]*?syncAction=\{enqueueVercelSync\}/,
    );
  });

  it('uses the shared server card for both providers without passing encrypted tokens', () => {
    expect(accountCard).not.toContain("'use client'");
    expect(page.match(/<ProviderAccountCard/g)).toHaveLength(2);
    expect(page).toContain(
      'tokenSuffix={displayTokenSuffix(account.encryptedToken)}',
    );
    expect(page).not.toMatch(
      /<ProviderAccountCard[\s\S]*?encryptedToken=/,
    );
  });
});
