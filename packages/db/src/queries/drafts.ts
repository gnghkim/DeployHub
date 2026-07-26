import {
  and,
  desc,
  eq,
} from 'drizzle-orm';
import type { Db } from '../client';
import { projectDrafts } from '../schema/registration';

export type DraftRow = typeof projectDrafts.$inferSelect;
export type NewDraft = typeof projectDrafts.$inferInsert;
export type DraftStatus = DraftRow['status'];

export async function listDrafts(
  db: Db,
  options: { status?: DraftStatus } = {},
): Promise<DraftRow[]> {
  if (options.status) {
    return db
      .select()
      .from(projectDrafts)
      .where(eq(projectDrafts.status, options.status))
      .orderBy(desc(projectDrafts.createdAt));
  }

  return db
    .select()
    .from(projectDrafts)
    .orderBy(desc(projectDrafts.createdAt));
}

export async function getDraft(db: Db, id: string): Promise<DraftRow | undefined> {
  const [draft] = await db
    .select()
    .from(projectDrafts)
    .where(eq(projectDrafts.id, id));
  return draft;
}

export async function insertDraft(db: Db, values: NewDraft): Promise<DraftRow> {
  return db.transaction(async (tx) => {
    if (values.projectId) {
      await tx
        .update(projectDrafts)
        .set({ status: 'superseded' })
        .where(and(
          eq(projectDrafts.projectId, values.projectId),
          eq(projectDrafts.status, 'pending_review'),
        ));
    }

    const [draft] = await tx
      .insert(projectDrafts)
      .values(values)
      .returning();
    if (!draft) throw new Error('project draft insert failed');
    return draft;
  });
}

export async function updateDraftStatus(
  db: Db,
  id: string,
  status: DraftStatus,
  review: {
    reviewedBy?: string | null;
    reviewedAt?: Date | null;
  } = {},
): Promise<DraftRow | undefined> {
  const [draft] = await db
    .update(projectDrafts)
    .set({
      status,
      ...review,
    })
    .where(eq(projectDrafts.id, id))
    .returning();
  return draft;
}
