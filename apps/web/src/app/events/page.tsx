import { listTimelineEvents } from '@deployhub/db';
import { TimelineList } from '@/components/events/timeline-list';
import { Topbar } from '@/components/shell/topbar';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function EventsPage() {
  const renderedAt = new Date();
  const { events } = await listTimelineEvents(db, {
    projectId: null,
  });

  return (
    <>
      <Topbar title="변경" />
      <main className="space-y-6 p-4 md:p-8">
        <div>
          <h2 className="text-xl font-medium text-[var(--color-ink)]">
            변경 이력
          </h2>
          <p className="mt-1 text-sm text-[var(--color-mute)]">
            최근 상태 전환을 발생 순서대로 보여줍니다.
          </p>
        </div>
        <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
          <TimelineList events={events} renderedAt={renderedAt} />
        </section>
      </main>
    </>
  );
}
