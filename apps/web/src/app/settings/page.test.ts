import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./page.tsx', import.meta.url)),
  'utf8',
);

describe('settings index', () => {
  it('links to all four settings screens with descriptions', () => {
    expect(source).toContain("href: '/settings/resources'");
    expect(source).toContain('자원');
    expect(source).toContain('수집된 저장소와 컨테이너');
    expect(source).toContain("href: '/settings/providers'");
    expect(source).toContain('Provider');
    expect(source).toContain('GitHub·Vercel 등 연동 계정');
    expect(source).toContain("href: '/settings/drafts'");
    expect(source).toContain('등록 초안');
    expect(source).toContain('AI가 올린 등록 요청 승인');
    expect(source).toContain("href: '/settings/tokens'");
    expect(source).toContain('등록 토큰');
    expect(source).toContain('CLI 등록에 쓰는 일회용 토큰');
  });
});
