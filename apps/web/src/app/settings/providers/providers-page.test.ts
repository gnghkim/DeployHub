import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

const page = source('./page.tsx');
const accountCard = source('./components/provider-account-card.tsx');

function matchingPageSource(pattern: RegExp): string {
  return page.match(pattern)?.[0] ?? '';
}

describe('provider settings page', () => {
  it('keeps the page server-rendered and loads accounts for all providers', () => {
    expect(page).not.toContain("'use client'");
    expect(page).toContain('provider: schema.providerAccounts.provider');
    expect(page).not.toMatch(
      /\.where\(\s*eq\(schema\.providerAccounts\.provider,\s*'github'\)\s*\)/,
    );
    expect(page).toContain("account.provider === 'github'");
    expect(page).toContain("account.provider === 'vercel'");
    expect(page).toContain("account.provider === 'supabase'");
  });

  it('preserves the GitHub connection form and sync behavior', () => {
    const connectGithub = matchingPageSource(
      /async function connectGithub\([\s\S]*?\n\}/,
    );
    const githubForm = matchingPageSource(
      /<form\b[^>]*\baction=\{connectGithub\}[^>]*>[\s\S]*?<\/form>/,
    );
    const githubSection = matchingPageSource(
      /<section\b[^>]*>[\s\S]*?<form\b[^>]*\baction=\{connectGithub\}[\s\S]*?<\/section>/,
    );
    const githubTokenInput = githubForm.match(
      /<Input\b[\s\S]*?name="token"[\s\S]*?\/>/,
    )?.[0] ?? '';
    const githubCards = matchingPageSource(
      /\{githubAccounts\.map\([\s\S]*?\)\)\}/,
    );

    expect(githubSection).toContain('GitHub 연결');
    expect(githubSection).toContain(
      '토큰은 연결 확인 후 암호화해 저장하며 다시 표시하지 않습니다.',
    );
    expect(connectGithub).toMatch(
      /await saveGithubProvider\(\s*\{ status: 'idle' \},\s*formData,?\s*\)/,
    );
    expect(githubForm).not.toBe('');
    expect(githubTokenInput).toContain('type="password"');
    expect(githubTokenInput).toMatch(/\srequired(?:\s|\/>)/);
    expect(githubCards).toContain('<ProviderAccountCard');
    expect(githubCards).toContain('syncAction={enqueueGithubSync}');
  });

  it('routes the Vercel connection form and sync cards to Vercel actions', () => {
    const connectVercel = matchingPageSource(
      /async function connectVercel\([\s\S]*?\n\}/,
    );
    const vercelForm = matchingPageSource(
      /<form\b[^>]*\baction=\{connectVercel\}[^>]*>[\s\S]*?<\/form>/,
    );

    expect(page).toContain('Vercel 연결');
    expect(connectVercel).toMatch(
      /await saveVercelProvider\(\s*\{ status: 'idle' \},\s*formData,?\s*\)/,
    );
    expect(vercelForm).not.toBe('');
    expect(vercelForm).toContain('name="teamId"');
    expect(vercelForm).toContain('개인 계정이면 비워둡니다');
    expect(page).toMatch(
      /vercelAccounts\.map[\s\S]*?<ProviderAccountCard[\s\S]*?syncAction=\{enqueueVercelSync\}/,
    );
  });

  it('stacks the Vercel form by default and aligns it horizontally at md', () => {
    const vercelForm = matchingPageSource(
      /<form\b[^>]*\baction=\{connectVercel\}[^>]*>[\s\S]*?<\/form>/,
    );
    const formOpeningTag = vercelForm.match(/<form\b[^>]*>/)?.[0] ?? '';
    const submitButton = vercelForm.match(
      /<Button\b[^>]*\btype="submit"[^>]*>/,
    )?.[0] ?? '';

    expect(formOpeningTag).toContain(
      'className="flex flex-col gap-3 md:flex-row md:items-start"',
    );
    expect(submitButton).toContain('className="md:mt-6"');
  });

  it('routes a password PAT form and account cards to Supabase actions', () => {
    const connectSupabase = matchingPageSource(
      /async function connectSupabase\([\s\S]*?\n\}/,
    );
    const supabaseSection = matchingPageSource(
      /<section\b[^>]*>[\s\S]*?<form\b[^>]*\baction=\{connectSupabase\}[\s\S]*?<\/section>/,
    );
    const supabaseForm = matchingPageSource(
      /<form\b[^>]*\baction=\{connectSupabase\}[^>]*>[\s\S]*?<\/form>/,
    );
    const tokenInput = supabaseForm.match(
      /<Input\b[\s\S]*?name="token"[\s\S]*?\/>/,
    )?.[0] ?? '';

    expect(supabaseSection).toContain('Supabase 연결');
    expect(supabaseSection).toContain(
      'PAT는 연결된 Supabase 사용자의 권한으로 동작합니다.',
    );
    expect(supabaseSection).toContain('최소 권한 계정');
    expect(connectSupabase).toMatch(
      /await saveSupabaseProvider\(\s*\{ status: 'idle' \},\s*formData,?\s*\)/,
    );
    expect(tokenInput).toContain('type="password"');
    expect(tokenInput).toMatch(/\srequired(?:\s|\/>)/);
    expect(page).toMatch(
      /supabaseAccounts\.map[\s\S]*?<ProviderAccountCard[\s\S]*?syncAction=\{enqueueSupabaseSync\}/,
    );
    expect(page).toContain('연결된 Supabase 계정이 없습니다.');
  });

  it('shows each empty-state message only through its provider condition', () => {
    const githubEmptyState = matchingPageSource(
      /\{\s*githubAccounts\.length\s*===\s*0\s*\?\s*\([\s\S]*?\)\s*:\s*null\s*\}/,
    );
    const vercelEmptyState = matchingPageSource(
      /\{\s*vercelAccounts\.length\s*===\s*0\s*\?\s*\([\s\S]*?\)\s*:\s*null\s*\}/,
    );
    const supabaseEmptyState = matchingPageSource(
      /\{\s*supabaseAccounts\.length\s*===\s*0\s*\?\s*\([\s\S]*?\)\s*:\s*null\s*\}/,
    );

    expect(githubEmptyState).toContain('연결된 GitHub 계정이 없습니다.');
    expect(vercelEmptyState).toContain('연결된 Vercel 계정이 없습니다.');
    expect(supabaseEmptyState).toContain(
      '연결된 Supabase 계정이 없습니다.',
    );
  });

  it('uses the shared server card for every provider without passing encrypted tokens', () => {
    expect(accountCard).not.toContain("'use client'");
    expect(page.match(/<ProviderAccountCard/g)).toHaveLength(3);
    expect(page).toContain(
      'tokenSuffix={displayTokenSuffix(account.encryptedToken)}',
    );
    expect(page).not.toMatch(
      /<ProviderAccountCard[\s\S]*?encryptedToken=/,
    );
  });
});
