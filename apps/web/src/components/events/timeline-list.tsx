import type { TimelineEvent } from '@deployhub/db';
import { formatRelativeTime } from '@/lib/backend-view';
import { formatDateTime } from '../../lib/datetime';

const SEVERITY_TEXT = {
  info: 'text-[var(--annotation)]',
  warning: 'text-[var(--caution)]',
  critical: 'text-[var(--fault)]',
} as const;

export function TimelineList({
  events,
  renderedAt,
  emptyMessage = '아직 기록된 변경이 없습니다',
}: {
  events: TimelineEvent[];
  renderedAt: Date;
  emptyMessage?: string;
}) {
  const rows = events.map((event) => ({
    event,
    relativeTime: formatRelativeTime(event.occurredAt, renderedAt),
  }));

  if (rows.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-[var(--annotation)]">
        {emptyMessage}
      </p>
    );
  }

  return (
    <ol className="divide-y divide-[var(--rule)]">
      {rows.map(({ event, relativeTime }) => (
        <li
          key={event.id}
          className="grid gap-2 px-4 py-4 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-4"
        >
          <div className="flex items-center gap-2 sm:block">
            <span
              className={`font-mono text-xs ${SEVERITY_TEXT[event.severity]}`}
            >
              {event.severity}
            </span>
            <time
              className="block font-mono text-xs text-[var(--annotation)] sm:mt-1"
              dateTime={event.occurredAt.toISOString()}
              title={formatDateTime(event.occurredAt)}
            >
              {relativeTime}
            </time>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
              <span className="font-mono text-xs text-[var(--annotation)]">
                {event.kind}
              </span>
              <p className="min-w-0 break-words text-[var(--line-mute)]">
                {event.previousValue === null ? (
                  <>
                    <span className="text-[var(--annotation)]">
                      최초 관측
                    </span>
                    <span aria-hidden="true"> · </span>
                    <span className="font-mono text-[var(--line)]">
                      {event.currentValue}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-mono">{event.previousValue}</span>
                    <span className="sr-only">에서</span>
                    <span aria-hidden="true"> → </span>
                    <span className="font-mono text-[var(--line)]">
                      {event.currentValue}
                    </span>
                    <span className="sr-only">으로 변경</span>
                  </>
                )}
              </p>
            </div>
            <p className="mt-1 text-xs text-[var(--annotation)]">
              {event.detail}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
