import {
  and,
  desc,
  eq,
  lt,
  notInArray,
  type SQL,
} from 'drizzle-orm';
import type { Db } from '../client';
import {
  changeEventKind,
  changeEvents,
  eventSeverity,
} from '../schema';

const DEFAULT_TIMELINE_LIMIT = 100;
const MAX_TIMELINE_LIMIT = 200;

export type TimelineEvent = typeof changeEvents.$inferSelect;

export type TimelineQueryOptions = {
  projectId: string | null;
  kind?: (typeof changeEventKind.enumValues)[number];
  severity?: (typeof eventSeverity.enumValues)[number];
  excludeIds?: string[];
  cursor?: bigint;
  limit?: number;
};

export type TimelinePage = {
  events: TimelineEvent[];
  nextCursor: bigint | null;
};

function boundedLimit(requested: number | undefined): number {
  if (requested === undefined || Number.isNaN(requested)) {
    return DEFAULT_TIMELINE_LIMIT;
  }
  return Math.max(
    1,
    Math.min(MAX_TIMELINE_LIMIT, Math.trunc(requested)),
  );
}

/**
 * Lists global or project history by the immutable event sequence.
 * Pages default to 100 rows and never exceed 200 rows.
 */
export async function listTimelineEvents(
  db: Db,
  options: TimelineQueryOptions,
): Promise<TimelinePage> {
  const limit = boundedLimit(options.limit);
  const conditions: SQL[] = [];
  if (options.projectId !== null) {
    conditions.push(eq(changeEvents.projectId, options.projectId));
  }
  if (options.kind !== undefined) {
    conditions.push(eq(changeEvents.kind, options.kind));
  }
  if (options.severity !== undefined) {
    conditions.push(eq(changeEvents.severity, options.severity));
  }
  if (
    options.excludeIds !== undefined
    && options.excludeIds.length > 0
  ) {
    conditions.push(notInArray(changeEvents.id, options.excludeIds));
  }
  if (options.cursor !== undefined) {
    conditions.push(lt(changeEvents.seq, options.cursor));
  }

  const rows = await db
    .select()
    .from(changeEvents)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(changeEvents.seq))
    .limit(limit + 1);
  const hasNextPage = rows.length > limit;
  const events = hasNextPage ? rows.slice(0, limit) : rows;

  return {
    events,
    nextCursor: hasNextPage
      ? events.at(-1)?.seq ?? null
      : null,
  };
}
