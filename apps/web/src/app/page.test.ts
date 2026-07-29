import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = (relativePath: string) => readFileSync(
  fileURLToPath(new URL(relativePath, import.meta.url)),
  'utf8',
);

describe('project overview routes', () => {
  it('renders project sheets and an actionable empty state at the root', () => {
    const home = source('./page.tsx');

    expect(home).toContain('listProjectsWithSummaryData');
    expect(home).toContain('<ProjectSheet');
    expect(home).toContain('프로젝트 {projects.length}');
    expect(home).toContain('아직 등록된 프로젝트가 없습니다.');
    expect(home).toContain('DeployHub에 등록해줘');
    expect(home).toContain('href="/settings/drafts"');
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

  it('renders one semantic list of project sheets at every viewport', () => {
    const home = source('./page.tsx');

    expect(home).toContain('<ul className="space-y-4">');
    expect(home).toContain('<ProjectSheet');
    expect(home).not.toContain('<Table');
    expect(home).not.toContain('md:hidden');
    expect(home).not.toContain('hidden md:block');
  });

  it('passes the existing M3 judgement tone into each project sheet', () => {
    const home = source('./page.tsx');

    expect(home).toContain('tone={STATUS_TONES[project.judgement]}');
  });

  it('keeps normal and unknown quiet while distinguishing warning and failure', () => {
    const home = source('./page.tsx');

    expect(home).toContain("정상: 'neutral'");
    expect(home).toContain("미확인: 'neutral'");
    expect(home).toContain("주의: 'caution'");
    expect(home).toContain("장애: 'fault'");
  });

  it('calculates each relative deployment time once on the server', () => {
    const home = source('./page.tsx');
    const projectSheet = source('../components/schematic/project-sheet.tsx');

    expect(home.match(/formatRelativeTime\(/g)).toHaveLength(1);
    expect(projectSheet.match(/\{project\.latestDeploymentRelative\}/g))
      .toHaveLength(1);
  });

  it('fetches only the discovered count and links to the discovery screen', () => {
    const home = source('./page.tsx');

    expect(home).toContain('countDiscoveredStacks');
    expect(home).not.toContain('listDiscoveredStacks');
    expect(home).toContain('등록되지 않은 스택 {discoveredCount}');
    expect(home).toContain('href="/discovered"');
  });
});
