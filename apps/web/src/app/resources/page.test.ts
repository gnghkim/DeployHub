import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(relativeUrl: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativeUrl, import.meta.url)),
    'utf8',
  );
}

describe('자원 화면 구성', () => {
  it('조회 화면은 서버 컴포넌트이며 세 영역을 표시한다', () => {
    const page = source('./page.tsx');

    expect(page).not.toContain("'use client'");
    expect(page).toContain('수집된 저장소');
    expect(page).toContain('연결 제안');
    expect(page).toContain('미연결 자원');
    expect(page).toContain('Unlinked');
  });

  it('프로젝트 상세에 연결된 자원 섹션이 있다', () => {
    const page = source('../projects/[slug]/page.tsx');
    expect(page).toContain('연결된 자원');
  });

  it('Overview에 네 가지 요약 지표가 있다', () => {
    const page = source('../page.tsx');
    expect(page).toContain('전체 프로젝트');
    expect(page).toContain('수집 저장소');
    expect(page).toContain('미연결');
    expect(page).toContain('최근 커밋 24시간');
  });
});
