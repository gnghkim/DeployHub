import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const page = readFileSync(
  fileURLToPath(new URL('./page.tsx', import.meta.url)),
  'utf8',
);

describe('project detail status', () => {
  it('구성도가 Annotation 으로 관측을 그린다', () => {
    const composition = readFileSync(
      fileURLToPath(new URL('./composition.tsx', import.meta.url)), 'utf8');
    expect(composition).toContain('<Annotation');
  });

  it('구성도만 Sheet 안에 그린다', () => {
    const composition = readFileSync(
      fileURLToPath(new URL('./composition.tsx', import.meta.url)), 'utf8');
    expect(composition).toContain('<Sheet');
    expect(page).not.toContain('<Sheet');
  });

  it('구성도의 관측 자리를 판정이 덮지 않는다', () => {
    const composition = readFileSync(
      fileURLToPath(new URL('./composition.tsx', import.meta.url)), 'utf8');
    expect(composition).not.toContain('judgeStatus');
    expect(composition).not.toContain('ProjectStatus');
  });

  it('Drift 에 경고색을 쓰지 않는다', () => {
    const page = readFileSync(
      fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');
    const driftBlock = page.slice(page.indexOf('DRIFT_LABELS'));
    expect(driftBlock).not.toContain("tone={conflict ? 'fault' : 'caution'}");
    expect(driftBlock).toContain('<Annotation');
    expect(driftBlock).toContain('drift=');
  });

  it('관측 상태 부재를 프로젝트 판정 문구로 표시하지 않는다', () => {
    const composition = readFileSync(
      fileURLToPath(new URL('./composition.tsx', import.meta.url)), 'utf8');
    expect(composition).not.toContain('상태 미확인');
  });

  it('adds the derived status to the top metadata line', () => {
    expect(page).toContain('listProjectStatusData(db, [project.id])');
    expect(page).toContain('<Badge tone={STATUS_TONES[status.status]}>');
    expect(page).toContain('{status.status}');
  });

  it('orders declared metadata before the judgement badge', () => {
    expect(page.indexOf('{project.lifecycle}'))
      .toBeLessThan(page.indexOf('중요도 {project.importance}'));
    expect(page.indexOf('중요도 {project.importance}'))
      .toBeLessThan(page.indexOf("{project.owner ?? '담당자 없음'}"));
    expect(page.indexOf("{project.owner ?? '담당자 없음'}"))
      .toBeLessThan(page.indexOf('<Badge tone={STATUS_TONES[status.status]}>'));
  });

  it('shows latest warning and critical evidence below the composition', () => {
    const composition = page.indexOf('<ArchitectureComposition');
    const evidence = page.indexOf('판정 근거');
    const deployments = page.indexOf('최종 배포');

    expect(page).toContain("event.severity === 'warning'");
    expect(page).toContain("event.severity === 'critical'");
    expect(page).toContain('{event.currentValue}');
    expect(page).toContain('{event.detail}');
    expect(composition).toBeLessThan(evidence);
    expect(evidence).toBeLessThan(deployments);
  });

  it('keeps current evidence separate from a project-scoped history timeline', () => {
    const evidence = page.indexOf('판정 근거');
    const deployments = page.indexOf('최종 배포');
    const timeline = page.indexOf('변경 이력');

    expect(page).toContain('listTimelineEvents(db, {');
    expect(page).toContain('projectId: project.id');
    expect(page).toContain('limit: 20');
    expect(page).toContain('<TimelineList');
    expect(page).toContain(
      'const evidenceEventIds = new Set(evidenceEvents.map',
    );
    expect(page).toContain(
      'const { events: historyEvents } = await listTimelineEvents',
    );
    expect(page).toContain('excludeIds: [...evidenceEventIds]');
    expect(page).toContain('events={historyEvents}');
    expect(page).not.toContain('timelinePage.events.filter');
    expect(page.indexOf('listProjectStatusData(db, [project.id])'))
      .toBeLessThan(page.lastIndexOf('listTimelineEvents(db, {'));
    expect(page).toContain(
      'emptyMessage="현재 판정 근거 외에 기록된 변경이 없습니다"',
    );
    expect(evidence).toBeLessThan(deployments);
    expect(deployments).toBeLessThan(timeline);
    expect(page).toContain('space-y-6 p-4 md:p-8');
  });

  it('shows Drift only when there is a difference', () => {
    expect(page).not.toContain('Drift 없음');
  });
});
