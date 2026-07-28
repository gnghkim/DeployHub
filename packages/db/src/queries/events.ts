import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { changeEventKind, changeEvents } from '../schema';

export type ChangeEventKind = (typeof changeEventKind.enumValues)[number];

export type ChangeEventInput = {
  projectId: string | null;
  componentId: string | null;
  resourceId: string | null;
  kind: ChangeEventKind;
  severity: 'info' | 'warning' | 'critical';
  currentValue: string;
  detail: string;
};

/** Do not write if currentValue equals the immediately preceding event. Return true only when written. */
export async function recordChangeIfChanged(
  db: Db,
  input: ChangeEventInput,
): Promise<boolean> {
  const lockKey = input.resourceId !== null
    ? `resource:${input.resourceId}:${input.kind}`
    : input.componentId !== null
      ? `component:${input.componentId}:${input.kind}`
      : input.projectId !== null
        ? `project:${input.projectId}:${input.kind}`
        : `global:${input.kind}`;
  const target = input.resourceId !== null
    ? eq(changeEvents.resourceId, input.resourceId)
    : input.componentId !== null
      ? and(
        isNull(changeEvents.resourceId),
        eq(changeEvents.componentId, input.componentId),
      )
    : input.projectId !== null
        ? and(
          isNull(changeEvents.resourceId),
          isNull(changeEvents.componentId),
          eq(changeEvents.projectId, input.projectId),
        )
        : and(
          isNull(changeEvents.resourceId),
          isNull(changeEvents.componentId),
          isNull(changeEvents.projectId),
        );

  return db.transaction(async (tx) => {
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    `);

    const [latest] = await tx
      .select({ currentValue: changeEvents.currentValue })
      .from(changeEvents)
      .where(and(target, eq(changeEvents.kind, input.kind)))
      .orderBy(desc(changeEvents.occurredAt), desc(changeEvents.id))
      .limit(1);

    if (latest?.currentValue === input.currentValue) return false;

    await tx.insert(changeEvents).values({
      projectId: input.projectId,
      componentId: input.componentId,
      resourceId: input.resourceId,
      kind: input.kind,
      severity: input.severity,
      previousValue: latest?.currentValue ?? null,
      currentValue: input.currentValue,
      detail: input.detail,
    });
    return true;
  });
}
