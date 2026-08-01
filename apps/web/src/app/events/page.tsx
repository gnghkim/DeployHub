import Link from 'next/link';
import { listProjects, listTimelineEvents } from '@deployhub/db';
import { TimelineList } from '@/components/events/timeline-list';
import { Topbar } from '@/components/shell/topbar';
import { db } from '@/lib/db';
import {
  buildEventsHref,
  parseEventFilters,
  type RawEventSearchParams,
} from './event-filters';

export const dynamic = 'force-dynamic';

const SELECT_CLASS = 'mt-1 block h-9 w-full rounded-[var(--radius-button)] border border-[var(--rule)] bg-[var(--paper)] px-3 text-sm text-[var(--line)]';

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<RawEventSearchParams>;
}) {
  const renderedAt = new Date();
  const [projects, rawSearchParams] = await Promise.all([
    listProjects(db),
    searchParams,
  ]);
  const filters = parseEventFilters(rawSearchParams, projects);
  const { events, nextCursor } = await listTimelineEvents(db, {
    projectId: filters.projectId,
    severity: filters.severity,
    kind: filters.kind,
    cursor: filters.cursor,
    limit: 50,
  });
  const projectNames: ReadonlyMap<string, string> = new Map(
    projects.map((project) => [project.id, project.name] as const),
  );

  return (
    <>
      <Topbar title="변경" />
      <main className="space-y-6 p-4 md:p-8">
        <div>
          <h2 className="text-xl font-medium text-[var(--line)]">
            변경 이력
          </h2>
          <p className="mt-1 text-sm text-[var(--annotation)]">
            최근 상태 전환을 발생 순서대로 보여줍니다.
          </p>
        </div>

        <form
          method="get"
          className="grid gap-3 rounded-[var(--radius-card)] border border-[var(--rule)] bg-[var(--paper)] p-4 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(0,1fr))_auto] lg:items-end"
        >
          <label className="text-xs text-[var(--annotation)]">
            프로젝트
            <select
              name="project"
              defaultValue={filters.projectSlug}
              className={SELECT_CLASS}
            >
              <option value="">전체 프로젝트</option>
              {projects.map((project) => (
                <option key={project.id} value={project.slug}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-[var(--annotation)]">
            심각도
            <select
              name="severity"
              defaultValue={filters.severity ?? ''}
              className={SELECT_CLASS}
            >
              <option value="">전체 심각도</option>
              <option value="info">정보</option>
              <option value="warning">주의</option>
              <option value="critical">장애</option>
            </select>
          </label>
          <label className="text-xs text-[var(--annotation)]">
            종류
            <select
              name="kind"
              defaultValue={filters.kind ?? ''}
              className={SELECT_CLASS}
            >
              <option value="">전체 종류</option>
              <option value="health_status">HTTP 상태</option>
              <option value="container_status">컨테이너 상태</option>
              <option value="container_health">컨테이너 헬스</option>
              <option value="deployment">배포</option>
              <option value="ssl_expiry">SSL 만료</option>
              <option value="sync_failure">동기화 실패</option>
            </select>
          </label>
          <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-1">
            <button
              type="submit"
              className="inline-flex h-9 items-center rounded-[var(--radius-button)] bg-[var(--line)] px-3 text-sm font-medium text-[var(--paper)]"
            >
              필터 적용
            </button>
            <Link
              href="/events"
              className="inline-flex h-9 items-center rounded-[var(--radius-button)] border border-[var(--rule)] px-3 text-sm font-medium text-[var(--line)] hover:bg-white/[0.02]"
            >
              초기화
            </Link>
          </div>
        </form>

        <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--rule)] bg-[var(--paper)]">
          <TimelineList
            events={events}
            renderedAt={renderedAt}
            projectNames={filters.projectId === null ? projectNames : undefined}
          />
        </section>

        {nextCursor !== null ? (
          <div className="flex justify-center">
            <Link
              href={buildEventsHref(filters, nextCursor)}
              className="inline-flex h-9 items-center rounded-[var(--radius-button)] border border-[var(--rule)] bg-[var(--paper)] px-3 text-sm font-medium text-[var(--line)] hover:bg-white/[0.02]"
            >
              다음 기록 보기
            </Link>
          </div>
        ) : null}
      </main>
    </>
  );
}
