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
    expect(page).toContain('수집된 자원');
    expect(page).toContain('연결 제안');
    expect(page).toContain('미연결 자원');
    expect(page).toContain('Unlinked');
  });

  it('provider와 resourceType을 서버에서 필터링한다', () => {
    const page = source('./page.tsx');

    expect(page).toContain('searchParams');
    expect(page).toContain('name="provider"');
    expect(page).toContain('name="resourceType"');
    expect(page).toContain('resource.provider === provider');
    expect(page).toContain('resource.resourceType === resourceType');
  });

  it('컨테이너 ID는 렌더링할 때만 12자로 줄인다', () => {
    const page = source('./page.tsx');

    expect(page).toContain('shortContainerId');
    expect(page).toContain("resource.resourceType === 'docker_container'");
  });

  it('이미 연결된 자원도 자원 행에서 다른 구성요소에 추가 연결할 수 있다', () => {
    const page = source('./page.tsx');

    expect(page).not.toMatch(/suggestMatches\(\s*unlinkedResources/);
    expect(page).toContain('const componentOptions');
    expect(page).toContain('components={componentOptions}');
  });

  it('각 기존 연결에 연결 해제 버튼이 있다', () => {
    const page = source('./page.tsx');

    expect(page).toContain('removeResourceLink');
    expect(page).toContain('name="linkId"');
    expect(page).toContain('연결 해제');
  });

  it('프로젝트 상세에 연결된 자원 섹션이 있다', () => {
    const page = source('../projects/[slug]/page.tsx');
    expect(page).toContain('연결된 자원');
  });

  it('프로젝트 상세가 선언, 관측, 다섯 drift, 최종 배포를 구분한다', () => {
    const page = source('../projects/[slug]/page.tsx');

    expect(page).toContain('뒷단');
    expect(page).toContain('선언');
    expect(page).toContain('관측');
    expect(page).toContain('declared_not_observed');
    expect(page).toContain('observed_not_declared');
    expect(page).toContain('image_mismatch');
    expect(page).toContain('provider_mismatch');
    expect(page).toContain('link_conflict');
    expect(page).toContain('최종 배포');
    expect(page).toContain('<time');
    expect(page).toContain('dateTime=');
    expect(page).toContain('title=');
  });

  it('Overview에 행동할 수 없는 요약 지표가 없다', () => {
    const page = source('../page.tsx');
    expect(page).not.toContain('전체 프로젝트');
    expect(page).not.toContain('수집 저장소');
    expect(page).not.toContain('실행 중 컨테이너');
    expect(page).not.toContain('미연결 자원');
    expect(page).not.toContain('Drift 있는 프로젝트');
  });
});
