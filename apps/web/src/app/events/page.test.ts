import {
  existsSync,
  readFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

const page = source('./page.tsx');
const timeline = source('../../components/events/timeline-list.tsx');

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
    expect(page).toMatch(/종류[\s\S]*<select[\s\S]*name="kind"/);
    expect(page).toContain('defaultValue={filters.projectSlug}');
    expect(page).toContain('defaultValue={filters.severity ?? \'\'}');
    expect(page).toContain('defaultValue={filters.kind ?? \'\'}');
    expect(page).toContain('<option value="info">정보</option>');
    expect(page).toContain('<option value="warning">주의</option>');
    expect(page).toContain('<option value="critical">장애</option>');
    expect(page).toContain('<option value="health_status">HTTP 상태</option>');
    expect(page).toContain('<option value="container_status">컨테이너 상태</option>');
    expect(page).toContain('<option value="container_health">컨테이너 헬스</option>');
    expect(page).toContain('<option value="deployment">배포</option>');
    expect(page).toContain('<option value="ssl_expiry">SSL 만료</option>');
    expect(page).toContain('<option value="sync_failure">동기화 실패</option>');
    expect(page).toContain('type="submit"');
    expect(page).toContain('필터 적용');
    expect(page).toContain('href="/events"');
    expect(page).toContain('초기화');
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
