// @vitest-environment happy-dom

import type { TimelineEvent } from '@deployhub/db';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  computeDrift: vi.fn(),
  getProjectBySlug: vi.fn(),
  listProjectResources: vi.fn(),
  listProjectStatusData: vi.fn(),
  listTimelineEvents: vi.fn(),
  notFound: vi.fn(),
  select: vi.fn(),
}));

vi.mock('@deployhub/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@deployhub/db')>(),
  computeDrift: mocks.computeDrift,
  getProjectBySlug: mocks.getProjectBySlug,
  listProjectResources: mocks.listProjectResources,
  listProjectStatusData: mocks.listProjectStatusData,
  listTimelineEvents: mocks.listTimelineEvents,
}));
vi.mock('../../../lib/db', () => ({
  db: { select: mocks.select },
}));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));

import ProjectDetailPage from './page';

const testFileUrl = import.meta.url.startsWith('file:')
  ? import.meta.url
  : pathToFileURL(import.meta.filename).href;
const pagePath = fileURLToPath(new URL('./page.tsx', testFileUrl));
const compositionPath = fileURLToPath(new URL('./composition.tsx', testFileUrl));
const page = readFileSync(
  pagePath,
  'utf8',
);

const now = new Date('2026-08-01T00:00:00.000Z');
const project = {
  id: 'project-1',
  name: 'DeployHub',
  slug: 'deployhub',
  description: null,
  status: 'active',
  lifecycle: 'production',
  importance: 3,
  owner: null,
  repository: null,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
  components: [],
  domains: [],
};
const evidenceEvent: TimelineEvent = {
  id: 'evidence-1',
  seq: 30n,
  projectId: project.id,
  componentId: null,
  resourceId: null,
  kind: 'health_status',
  severity: 'warning',
  previousValue: 'ready',
  currentValue: 'degraded',
  detail: '현재 판정 근거입니다.',
  notifiedAt: null,
  occurredAt: now,
};
const historyEvents: TimelineEvent[] = [
  {
    ...evidenceEvent,
    id: 'history-1',
    seq: 20n,
    kind: 'deployment',
    severity: 'info',
    previousValue: 'building',
    currentValue: 'ready',
    detail: '첫 번째 과거 변경입니다.',
  },
  {
    ...evidenceEvent,
    id: 'history-2',
    seq: 10n,
    kind: 'container_status',
    severity: 'info',
    previousValue: 'restarting',
    currentValue: 'running',
    detail: '두 번째 과거 변경입니다.',
  },
];

async function renderPage() {
  const tree = await ProjectDetailPage({
    params: Promise.resolve({ slug: project.slug }),
  });
  const markup = renderToStaticMarkup(tree);
  const container = document.createElement('div');
  container.innerHTML = markup;
  return { container, markup };
}

function sectionHeadings(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll('section h3'),
    (heading) => heading.textContent?.trim() ?? '',
  );
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function statusData() {
  return new Map([[project.id, {
    status: '주의' as const,
    hasObservation: true,
    latestEvents: [evidenceEvent],
  }]]);
}

beforeEach(() => {
  mocks.computeDrift.mockReset();
  mocks.computeDrift.mockResolvedValue([]);
  mocks.getProjectBySlug.mockReset();
  mocks.getProjectBySlug.mockResolvedValue(project);
  mocks.listProjectResources.mockReset();
  mocks.listProjectResources.mockResolvedValue([]);
  mocks.listProjectStatusData.mockReset();
  mocks.listProjectStatusData.mockResolvedValue(statusData());
  mocks.listTimelineEvents.mockReset();
  mocks.listTimelineEvents.mockResolvedValue({
    events: historyEvents,
    nextCursor: null,
  });
  mocks.notFound.mockReset();
  mocks.notFound.mockImplementation(() => {
    throw new Error('NOT_FOUND');
  });
  mocks.select.mockReset();
  mocks.select.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        orderBy: async () => [],
      }),
    }),
  }));
});

describe('project detail status', () => {
  it('구성도가 Annotation 으로 관측을 그린다', () => {
    const composition = readFileSync(
      compositionPath,
      'utf8',
    );
    expect(composition).toContain('<Annotation');
  });

  it('구성도만 Sheet 안에 그린다', () => {
    const composition = readFileSync(
      compositionPath,
      'utf8',
    );
    expect(composition).toContain('<Sheet');
    expect(page).not.toContain('<Sheet');
  });

  it('구성도의 관측 자리를 판정이 덮지 않는다', () => {
    const composition = readFileSync(
      compositionPath,
      'utf8',
    );
    expect(composition).not.toContain('judgeStatus');
    expect(composition).not.toContain('ProjectStatus');
  });

  it('Drift 에 경고색을 쓰지 않는다', () => {
    const page = readFileSync(
      pagePath,
      'utf8',
    );
    const driftBlock = page.slice(page.indexOf('DRIFT_LABELS'));
    expect(driftBlock).not.toContain("tone={conflict ? 'fault' : 'caution'}");
    expect(driftBlock).toContain('<Annotation');
    expect(driftBlock).toContain('drift=');
  });

  it('관측 상태 부재를 프로젝트 판정 문구로 표시하지 않는다', () => {
    const composition = readFileSync(
      compositionPath,
      'utf8',
    );
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

  it('queries five project history events while excluding current evidence', async () => {
    await renderPage();

    expect(mocks.listTimelineEvents).toHaveBeenCalledWith(
      { select: mocks.select },
      {
        projectId: project.id,
        excludeIds: [evidenceEvent.id],
        limit: 5,
      },
    );
    expect(mocks.listTimelineEvents).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ limit: 20 }),
    );
  });

  it('starts history after status resolves without waiting for unrelated data', async () => {
    const resources = deferred<[]>();
    const status = deferred<ReturnType<typeof statusData>>();
    mocks.listProjectResources.mockReturnValue(resources.promise);
    mocks.listProjectStatusData.mockReturnValue(status.promise);

    const rendering = renderPage();
    await vi.waitFor(() => {
      expect(mocks.listProjectStatusData).toHaveBeenCalledOnce();
    });
    status.resolve(statusData());
    await status.promise;
    await Promise.resolve();
    const historyCallsBeforeResources = mocks.listTimelineEvents.mock.calls.length;

    resources.resolve([]);
    await rendering;

    expect(historyCallsBeforeResources).toBe(1);
  });

  it('renders returned history count and preserves evidence, deployment, and history order', async () => {
    const { container } = await renderPage();
    const headings = sectionHeadings(container);
    const evidence = headings.indexOf('판정 근거');
    const deployments = headings.indexOf('최종 배포');
    const history = headings.indexOf('최근 변경');

    expect(container.textContent).toContain('현재 판정 근거입니다.');
    expect(container.textContent).toContain('첫 번째 과거 변경입니다.');
    expect(container.textContent).toContain('두 번째 과거 변경입니다.');
    expect(container.textContent).toContain('최근 2건');
    expect(evidence).toBeGreaterThanOrEqual(0);
    expect(evidence).toBeLessThan(deployments);
    expect(deployments).toBeLessThan(history);
  });

  it('omits the full history link when there is no next cursor', async () => {
    const { container } = await renderPage();

    expect(Array.from(container.querySelectorAll('a')).some(
      (link) => link.textContent?.trim() === '전체 변경 이력 보기',
    )).toBe(false);
  });

  it('links to unpaginated project history only when more events exist', async () => {
    mocks.listTimelineEvents.mockResolvedValue({
      events: historyEvents,
      nextCursor: 9n,
    });

    const { container } = await renderPage();
    const link = Array.from(container.querySelectorAll('a')).find(
      (candidate) => candidate.textContent?.trim() === '전체 변경 이력 보기',
    );

    expect(link?.getAttribute('href')).toBe('/events?project=deployhub');
    expect(link?.getAttribute('href')).not.toMatch(/cursor|severity|kind/);
  });

  it('keeps the exact history empty state inside the existing bordered wrapper', async () => {
    mocks.listTimelineEvents.mockResolvedValue({
      events: [],
      nextCursor: null,
    });

    const { container } = await renderPage();
    const empty = Array.from(container.querySelectorAll('p')).find(
      (item) => item.textContent?.trim()
        === '현재 판정 근거 외에 기록된 변경이 없습니다',
    );

    expect(container.textContent).toContain('최근 0건');
    expect(empty?.parentElement?.className).toBe(
      'mt-4 overflow-hidden rounded-[var(--radius-card)] border border-[var(--rule)]',
    );
  });

  it('keeps current evidence separate from a project-scoped history timeline', () => {
    const evidence = page.indexOf('판정 근거');
    const deployments = page.indexOf('최종 배포');
    const timeline = page.indexOf('최근 변경');

    expect(page).toContain(
      "import { buildEventsHref } from '../../events/event-filters';",
    );
    expect(page).toContain('listTimelineEvents(db, {');
    expect(page).toContain('projectId: project.id');
    expect(page).toContain('limit: 5');
    expect(page).not.toContain('limit: 20');
    expect(page).toContain('<TimelineList');
    expect(page).toContain(
      'const evidenceEventIds = new Set(evidenceEvents.map',
    );
    expect(page).toContain('events: historyEvents');
    expect(page).toContain('nextCursor: historyNextCursor');
    expect(page).toContain('excludeIds: [...evidenceEventIds]');
    expect(page).toContain('events={historyEvents}');
    expect(page).not.toContain('timelinePage.events.filter');
    expect(page.indexOf('listProjectStatusData(db, [project.id])'))
      .toBeLessThan(page.lastIndexOf('listTimelineEvents(db, {'));
    expect(page).toContain(
      'emptyMessage="현재 판정 근거 외에 기록된 변경이 없습니다"',
    );
    expect(page).toContain('historyNextCursor !== null');
    expect(page).toContain('전체 변경 이력 보기');
    expect(page).toContain('projectSlug: project.slug');
    expect(page).toContain('severity: undefined');
    expect(page).toContain('kind: undefined');
    expect(evidence).toBeLessThan(deployments);
    expect(deployments).toBeLessThan(timeline);
    expect(page).toContain('space-y-6 p-4 md:p-8');
  });

  it('shows Drift only when there is a difference', () => {
    expect(page).not.toContain('Drift 없음');
  });
});
