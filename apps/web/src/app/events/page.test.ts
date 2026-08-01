// @vitest-environment happy-dom

import type { ProjectRow, TimelineEvent } from '@deployhub/db';
import {
  existsSync,
  readFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  listTimelineEvents: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('@deployhub/db', async (importOriginal) => ({
  ...await importOriginal<typeof import('@deployhub/db')>(),
  listProjects: mocks.listProjects,
  listTimelineEvents: mocks.listTimelineEvents,
}));
vi.mock('../../lib/db', () => ({ db: {} }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

import EventsPage from './page';
import type { RawEventSearchParams } from './event-filters';

function source(relativePath: string): string {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

const page = source('./page.tsx');
const timeline = source('../../components/events/timeline-list.tsx');

const now = new Date('2026-08-01T00:00:00.000Z');
const projects: ProjectRow[] = [{
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
}];
const timelineEvent: TimelineEvent = {
  id: 'event-1',
  seq: 20n,
  projectId: 'project-1',
  componentId: null,
  resourceId: null,
  kind: 'deployment',
  severity: 'warning',
  previousValue: 'building',
  currentValue: 'ready',
  detail: '배포가 완료되었습니다.',
  notifiedAt: null,
  occurredAt: now,
};

async function renderPage(searchParams: RawEventSearchParams) {
  const tree = await EventsPage({ searchParams: Promise.resolve(searchParams) });
  const markup = renderToStaticMarkup(tree);
  const container = document.createElement('div');
  container.innerHTML = markup;
  return { container, markup };
}

function selectedValue(container: HTMLElement, name: string): string | undefined {
  return container
    .querySelector(`select[name="${name}"] option[selected]`)
    ?.getAttribute('value') ?? undefined;
}

beforeEach(() => {
  mocks.listProjects.mockReset();
  mocks.listProjects.mockResolvedValue(projects);
  mocks.listTimelineEvents.mockReset();
  mocks.listTimelineEvents.mockResolvedValue({
    events: [timelineEvent],
    nextCursor: null,
  });
  mocks.redirect.mockReset();
  mocks.redirect.mockImplementation((href: string) => {
    throw new Error(`REDIRECT:${href}`);
  });
});

describe('events page behavior', () => {
  it('queries with normalized filters and preserves selected options', async () => {
    const { container } = await renderPage({
      project: 'deployhub',
      severity: 'warning',
      kind: 'deployment',
      cursor: '42',
    });

    expect(mocks.listTimelineEvents).toHaveBeenCalledWith({}, {
      projectId: 'project-1',
      severity: 'warning',
      kind: 'deployment',
      cursor: 42n,
      limit: 50,
    });
    expect(selectedValue(container, 'project')).toBe('deployhub');
    expect(selectedValue(container, 'severity')).toBe('warning');
    expect(selectedValue(container, 'kind')).toBe('deployment');
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('redirects valid parameters in noncanonical order before querying', async () => {
    await expect(renderPage({
      cursor: '42',
      kind: 'deployment',
      project: 'deployhub',
      severity: 'warning',
    })).rejects.toThrow(
      'REDIRECT:/events?project=deployhub&severity=warning&kind=deployment&cursor=42',
    );

    expect(mocks.redirect).toHaveBeenCalledTimes(1);
    expect(mocks.listTimelineEvents).not.toHaveBeenCalled();
  });

  it('renders global project context but omits it in a project view', async () => {
    const global = await renderPage({});
    const globalEvent = Array.from(global.container.querySelectorAll('li')).find(
      (item) => item.textContent?.includes('배포가 완료되었습니다.'),
    );
    expect(globalEvent?.textContent).toContain('DeployHub');

    const scoped = await renderPage({ project: 'deployhub' });
    const scopedEvent = Array.from(scoped.container.querySelectorAll('li')).find(
      (item) => item.textContent?.includes('배포가 완료되었습니다.'),
    );
    expect(scopedEvent?.textContent).not.toContain('DeployHub');
  });

  it('renders an exact stable next-page link with active filters', async () => {
    mocks.listTimelineEvents.mockResolvedValue({
      events: [timelineEvent],
      nextCursor: 19n,
    });

    const { container } = await renderPage({
      project: 'deployhub',
      severity: 'warning',
      kind: 'deployment',
      cursor: '42',
    });

    const next = Array.from(container.querySelectorAll('a')).find(
      (link) => link.textContent?.includes('다음 기록 보기'),
    );
    expect(next?.getAttribute('href')).toBe(
      '/events?project=deployhub&severity=warning&kind=deployment&cursor=19',
    );
  });

  it.each([
    { events: [timelineEvent], name: 'last page' },
    { events: [], name: 'empty page' },
  ])('omits the next link on the $name', async ({ events }) => {
    mocks.listTimelineEvents.mockResolvedValue({ events, nextCursor: null });

    const { markup } = await renderPage({});

    expect(markup).not.toContain('다음 기록 보기');
  });

  it('canonicalizes form-style empty parameters without querying events', async () => {
    await expect(renderPage({
      project: '',
      severity: '',
      kind: '',
    })).rejects.toThrow('REDIRECT:/events');

    expect(mocks.listTimelineEvents).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'invalid scalar',
      searchParams: {
        project: 'deployhub',
        severity: 'urgent',
        kind: 'deployment',
        cursor: '42',
      },
    },
    {
      name: 'repeated value',
      searchParams: {
        project: 'deployhub',
        severity: ['warning', 'critical'],
        kind: 'deployment',
        cursor: '42',
      },
    },
  ])('canonicalizes mixed valid and $name parameters', async ({ searchParams }) => {
    await expect(renderPage(searchParams)).rejects.toThrow(
      'REDIRECT:/events?project=deployhub&kind=deployment&cursor=42',
    );

    expect(mocks.listTimelineEvents).not.toHaveBeenCalled();
  });

  it('does not redirect an already canonical empty request', async () => {
    await renderPage({});

    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('renders exact approved labels and enum tokens for every option', async () => {
    const { container } = await renderPage({});
    const severity = container.querySelector<HTMLSelectElement>(
      'select[name="severity"]',
    );
    const kind = container.querySelector<HTMLSelectElement>('select[name="kind"]');

    expect(severity?.labels[0]?.textContent).toContain('심각도');
    expect(Array.from(severity?.options ?? [], ({ value, text }) => [value, text]))
      .toEqual([
        ['', '전체 심각도'],
        ['info', '정보 (info)'],
        ['warning', '주의 (warning)'],
        ['critical', '장애 (critical)'],
      ]);
    expect(kind?.labels[0]?.textContent).toContain('변경 종류');
    expect(Array.from(kind?.options ?? [], ({ value, text }) => [value, text]))
      .toEqual([
        ['', '전체 변경 종류'],
        ['health_status', 'HTTP 상태 (health_status)'],
        ['container_status', '컨테이너 상태 (container_status)'],
        ['container_health', '컨테이너 헬스 (container_health)'],
        ['deployment', '배포 (deployment)'],
        ['ssl_expiry', 'SSL 만료 (ssl_expiry)'],
        ['sync_failure', '동기화 실패 (sync_failure)'],
      ]);
    expect(container.textContent).toContain('필터 초기화');
    expect(container.querySelector('[name="cursor"]')).toBeNull();
  });
});

describe('global events timeline', () => {
  it('info 에 색을 주지 않는다', () => {
    expect(timeline).toMatch(
      /info:\s*'text-\[var\(--annotation\)\]'/,
    );
  });

  it('값을 모노로 렌더한다', () => {
    expect(timeline).toContain('font-mono');
  });

  it('supports optional project context labels on timeline rows', () => {
    expect(timeline).toContain('projectNames?: ReadonlyMap<string, string>');
    expect(timeline).toContain("event.projectId === null");
    expect(timeline).toContain("'전역'");
    expect(timeline).toContain("projectNames.get(event.projectId) ?? '삭제된 프로젝트'");
  });

  it('is a dynamic server page backed by parsed filters and a 50-row query', () => {
    expect(page).not.toContain("'use client'");
    expect(page).toContain("export const dynamic = 'force-dynamic'");
    expect(page).toContain('searchParams: Promise<RawEventSearchParams>');
    expect(page).toContain('listProjects(db)');
    expect(page).toMatch(
      /Promise\.all\(\[[\s\S]*listProjects\(db\)[\s\S]*searchParams[\s\S]*\]\)/,
    );
    expect(page).toContain('parseEventFilters(rawSearchParams, projects)');
    expect(page).toContain('listTimelineEvents(db, {');
    expect(page).toContain('projectId: filters.projectId');
    expect(page).toContain('severity: filters.severity');
    expect(page).toContain('kind: filters.kind');
    expect(page).toContain('cursor: filters.cursor');
    expect(page).toContain('limit: 50');
    expect(page).toContain('const renderedAt = new Date()');
    expect(page).toContain('<TimelineList');
  });

  it('renders a GET form with every supported labeled filter and no cursor field', () => {
    expect(page).toMatch(/<form\s+method="get"/);
    expect(page).toMatch(/프로젝트[\s\S]*<select[\s\S]*name="project"/);
    expect(page).toMatch(/심각도[\s\S]*<select[\s\S]*name="severity"/);
    expect(page).toMatch(/변경 종류[\s\S]*<select[\s\S]*name="kind"/);
    expect(page).toContain('defaultValue={filters.projectSlug}');
    expect(page).toContain('defaultValue={filters.severity ?? \'\'}');
    expect(page).toContain('defaultValue={filters.kind ?? \'\'}');
    expect(page).toContain('schema.eventSeverity.enumValues.map');
    expect(page).toContain('schema.changeEventKind.enumValues.map');
    expect(page).toContain('type="submit"');
    expect(page).toContain('필터 적용');
    expect(page).toContain('href="/events"');
    expect(page).toContain('필터 초기화');
    expect(page).not.toMatch(/name=["']cursor["']/);
  });

  it('shows project context only for the global view', () => {
    expect(page).toContain(
      'const projectNames: ReadonlyMap<string, string> = new Map(',
    );
    expect(page).toContain(
      'projectNames={filters.projectId === null ? projectNames : undefined}',
    );
  });

  it('builds the conditional next link from normalized active filters', () => {
    expect(page).toContain('nextCursor !== null');
    expect(page).toContain('href={buildEventsHref(filters, nextCursor)}');
    expect(page).toContain('다음 기록 보기');
  });

  it('lets missing or invalid values flow through the fail-soft parser', () => {
    expect(page).toContain('parseEventFilters(rawSearchParams, projects)');
    expect(page).not.toMatch(/rawSearchParams\.(project|severity|kind|cursor)/);
    expect(page).toMatch(
      /projectId: filters\.projectId[\s\S]*severity: filters\.severity[\s\S]*kind: filters\.kind[\s\S]*cursor: filters\.cursor/,
    );
  });

  it('uses compact mobile padding and the exact empty state', () => {
    expect(page).toContain('space-y-6 p-4 md:p-8');
    expect(timeline).toContain(
      "emptyMessage = '아직 기록된 변경이 없습니다'",
    );
    expect(timeline).toContain('{emptyMessage}');
    expect(page).not.toContain('Badge');
  });

  it('renders static server-relative and absolute times accessibly', () => {
    expect(timeline).not.toContain("'use client'");
    expect(timeline).toContain('formatRelativeTime(');
    expect(timeline).toContain('renderedAt');
    expect(timeline).toContain('<time');
    expect(timeline).toContain(
      'className="block font-mono text-xs text-[var(--annotation)] sm:mt-1"',
    );
    expect(timeline).toContain('dateTime={event.occurredAt.toISOString()}');
    expect(timeline).toContain(
      "import { formatDateTime } from '../../lib/datetime';",
    );
    expect(timeline).toContain('title={formatDateTime(event.occurredAt)}');
  });

  it('shows transitions, marks first observations, and puts detail below', () => {
    expect(timeline).toContain("event.previousValue === null");
    expect(timeline).toContain('최초 관측');
    expect(timeline).toContain('{event.previousValue}');
    expect(timeline).toContain('→');
    expect(timeline).toContain('{event.currentValue}');
    expect(timeline).toContain('className="sr-only">에서</span>');
    expect(timeline).toContain(
      'className="sr-only">으로 변경</span>',
    );
    expect(timeline).toContain('{event.detail}');
    expect(timeline).toMatch(
      /event\.currentValue[\s\S]+mt-1 text-xs[\s\S]+event\.detail/,
    );
  });

  it('keeps info quiet and uses only existing warning and error tokens for elevated severities', () => {
    expect(timeline).toContain("info: 'text-[var(--annotation)]'");
    expect(timeline).toContain(
      "warning: 'text-[var(--caution)]'",
    );
    expect(timeline).toContain(
      "critical: 'text-[var(--fault)]'",
    );
    expect(timeline).not.toContain('--accent');
    expect(timeline).not.toMatch(/bg-\[var\(--(caution|fault)\)\]/);
  });
});
