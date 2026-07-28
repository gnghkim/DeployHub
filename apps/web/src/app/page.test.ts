import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = (relativePath: string) => readFileSync(
  fileURLToPath(new URL(relativePath, import.meta.url)),
  'utf8',
);

describe('project overview routes', () => {
  it('renders the project summary list and an actionable empty state at the root', () => {
    const home = source('./page.tsx');

    expect(home).toContain('listProjectsWithSummaryData');
    expect(home).toContain('summarizeProject');
    expect(home).toContain('프로젝트 {projects.length}');
    expect(home).toContain('아직 등록된 프로젝트가 없습니다.');
    expect(home).toContain('DeployHub에 등록해줘');
    expect(home).toContain('href="/drafts"');
    expect(home).toContain('등록 초안');
  });

  it('removes unactionable overview metrics and the duplicate identity card', () => {
    const home = source('./page.tsx');

    expect(home).not.toContain('전체 프로젝트');
    expect(home).not.toContain('수집 저장소');
    expect(home).not.toContain('실행 중 컨테이너');
    expect(home).not.toContain('미연결 자원');
    expect(home).not.toContain('Drift 있는 프로젝트');
    expect(home).not.toContain('Signed in as');
    expect(home).not.toContain('computeDrift');
  });

  it('redirects the legacy project list route on the server', () => {
    const projects = source('./projects/page.tsx');

    expect(projects).not.toContain("'use client'");
    expect(projects).toContain("from 'next/navigation'");
    expect(projects).toContain("redirect('/');");
  });
});
