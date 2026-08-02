import { eq } from 'drizzle-orm';
import type { Db } from '../client';
import { projectSnapshots, projects } from '../schema/projects';

export type ProjectSnapshotState = typeof projectSnapshots.$inferSelect;

export type SnapshotErrorCode =
  | 'timeout'
  | 'blocked_target'
  | 'navigation_failed'
  | 'render_failed'
  | 'image_too_large';

type SnapshotImageInput = {
  projectId: string;
  imageData: Buffer;
  width: number;
  height: number;
  checksum: string;
  capturedAt?: Date;
};

export type AutomaticSnapshotInput = SnapshotImageInput & {
  url: string;
  deploymentId?: string | null;
};

export type ManualSnapshotInput = SnapshotImageInput;

export async function getSnapshotState(
  db: Db,
  projectId: string,
): Promise<ProjectSnapshotState | undefined> {
  const [snapshot] = await db
    .select()
    .from(projectSnapshots)
    .where(eq(projectSnapshots.projectId, projectId));
  return snapshot;
}

export async function markSnapshotPending(db: Db, projectId: string): Promise<void> {
  const attemptedAt = new Date();
  await db
    .insert(projectSnapshots)
    .values({
      projectId,
      lastAttemptAt: attemptedAt,
      lastAttemptStatus: 'pending',
      lastError: null,
      updatedAt: attemptedAt,
    })
    .onConflictDoUpdate({
      target: projectSnapshots.projectId,
      set: {
        lastAttemptAt: attemptedAt,
        lastAttemptStatus: 'pending',
        lastError: null,
        updatedAt: attemptedAt,
      },
    });
}

export async function saveAutomaticSnapshot(
  db: Db,
  input: AutomaticSnapshotInput,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [project] = await tx
      .select({
        snapshotMode: projects.snapshotMode,
        snapshotUrl: projects.snapshotUrl,
      })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .for('update');

    if (
      project?.snapshotMode !== 'automatic'
      || project.snapshotUrl !== input.url
    ) {
      return false;
    }

    const capturedAt = input.capturedAt ?? new Date();
    const attemptedAt = new Date();
    const snapshot = {
      imageData: input.imageData,
      contentType: 'image/webp' as const,
      width: input.width,
      height: input.height,
      source: 'automatic' as const,
      sourceUrl: input.url,
      deploymentId: input.deploymentId ?? null,
      checksum: input.checksum,
      capturedAt,
      lastAttemptAt: attemptedAt,
      lastAttemptStatus: 'success' as const,
      lastError: null,
      updatedAt: attemptedAt,
    };

    await tx
      .insert(projectSnapshots)
      .values({ projectId: input.projectId, ...snapshot })
      .onConflictDoUpdate({
        target: projectSnapshots.projectId,
        set: snapshot,
      });
    return true;
  });
}

export async function saveManualSnapshot(
  db: Db,
  input: ManualSnapshotInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .for('update');
    if (!project) throw new Error('project not found');

    const capturedAt = input.capturedAt ?? new Date();
    const attemptedAt = new Date();
    const snapshot = {
      imageData: input.imageData,
      contentType: 'image/webp' as const,
      width: input.width,
      height: input.height,
      source: 'manual' as const,
      sourceUrl: null,
      deploymentId: null,
      checksum: input.checksum,
      capturedAt,
      lastAttemptAt: attemptedAt,
      lastAttemptStatus: 'success' as const,
      lastError: null,
      updatedAt: attemptedAt,
    };

    await tx
      .insert(projectSnapshots)
      .values({ projectId: input.projectId, ...snapshot })
      .onConflictDoUpdate({
        target: projectSnapshots.projectId,
        set: snapshot,
      });
    await tx
      .update(projects)
      .set({ snapshotMode: 'manual', updatedAt: attemptedAt })
      .where(eq(projects.id, input.projectId));
  });
}

export async function markSnapshotFailed(
  db: Db,
  projectId: string,
  errorCode: SnapshotErrorCode,
): Promise<void> {
  const attemptedAt = new Date();
  await db
    .insert(projectSnapshots)
    .values({
      projectId,
      lastAttemptAt: attemptedAt,
      lastAttemptStatus: 'failed',
      lastError: errorCode,
      updatedAt: attemptedAt,
    })
    .onConflictDoUpdate({
      target: projectSnapshots.projectId,
      set: {
        lastAttemptAt: attemptedAt,
        lastAttemptStatus: 'failed',
        lastError: errorCode,
        updatedAt: attemptedAt,
      },
    });
}

export async function resumeAutomaticSnapshot(db: Db, projectId: string): Promise<void> {
  await db
    .update(projects)
    .set({ snapshotMode: 'automatic', updatedAt: new Date() })
    .where(eq(projects.id, projectId));
}

export async function deleteSnapshotImage(db: Db, projectId: string): Promise<void> {
  await db
    .update(projectSnapshots)
    .set({
      imageData: null,
      contentType: null,
      width: null,
      height: null,
      source: null,
      sourceUrl: null,
      deploymentId: null,
      checksum: null,
      capturedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(projectSnapshots.projectId, projectId));
}
