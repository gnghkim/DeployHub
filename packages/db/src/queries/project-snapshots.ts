import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../client';
import { coalesceSnapshotCaptureJob } from '../jobs/queue';
import { projectSnapshots, projects } from '../schema/projects';
import { jobs } from '../schema/jobs';

export type ProjectSnapshotState = typeof projectSnapshots.$inferSelect;

export type SnapshotErrorCode =
  | 'timeout'
  | 'blocked_target'
  | 'navigation_failed'
  | 'render_failed'
  | 'image_too_large';

export class SnapshotProjectNotFoundError extends Error {
  readonly projectId: string;

  constructor(projectId: string) {
    super(`snapshot project not found: ${projectId}`);
    this.name = 'SnapshotProjectNotFoundError';
    this.projectId = projectId;
  }
}

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
  attemptedAt?: Date;
};

export type ManualSnapshotInput = SnapshotImageInput;

export type SnapshotPendingAttempt = {
  attemptedAt: Date;
};

export type ReconcileStaleSnapshotCaptureInput = {
  jobId: string;
  projectId: string;
  expectedUrl: string;
  attemptedAt?: Date;
};

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

export async function markSnapshotPendingAttempt(
  db: Db,
  projectId: string,
  expectedUrl: string,
): Promise<SnapshotPendingAttempt | false> {
  return db.transaction(async (tx) => {
    const [project] = await tx
      .select({
        snapshotMode: projects.snapshotMode,
        snapshotUrl: projects.snapshotUrl,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for('update');
    if (!project) throw new SnapshotProjectNotFoundError(projectId);
    if (
      project.snapshotMode !== 'automatic'
      || project.snapshotUrl !== expectedUrl
    ) {
      return false;
    }

    const [previousAttempt] = await tx
      .select({ lastAttemptAt: projectSnapshots.lastAttemptAt })
      .from(projectSnapshots)
      .where(eq(projectSnapshots.projectId, projectId));
    const attemptedAt = new Date(Math.max(
      Date.now(),
      (previousAttempt?.lastAttemptAt?.getTime() ?? -1) + 1,
    ));
    await tx
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
    return { attemptedAt };
  });
}

export async function markSnapshotPending(
  db: Db,
  projectId: string,
  expectedUrl: string,
): Promise<boolean> {
  return (await markSnapshotPendingAttempt(db, projectId, expectedUrl)) !== false;
}

export async function reconcileStaleSnapshotCapture(
  db: Db,
  input: ReconcileStaleSnapshotCaptureInput,
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
    if (!project) throw new SnapshotProjectNotFoundError(input.projectId);
    if (
      project.snapshotMode === 'automatic'
      && project.snapshotUrl === input.expectedUrl
    ) {
      return false;
    }

    const dedupeKey = `snapshot:${input.projectId}`;
    await tx.execute(sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${dedupeKey}, 0))
    `);
    const [activeJob] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(
        eq(jobs.id, input.jobId),
        eq(jobs.type, 'snapshot.capture'),
        eq(jobs.status, 'running'),
      ))
      .for('update');
    if (!activeJob) return false;

    const reconciledAt = new Date();
    if (input.attemptedAt !== undefined) {
      await tx
        .update(projectSnapshots)
        .set({
          lastAttemptAt: null,
          lastAttemptStatus: null,
          lastError: null,
          updatedAt: reconciledAt,
        })
        .where(and(
          eq(projectSnapshots.projectId, input.projectId),
          eq(projectSnapshots.lastAttemptStatus, 'pending'),
          eq(projectSnapshots.lastAttemptAt, input.attemptedAt),
        ));
    }

    if (project.snapshotMode === 'automatic' && project.snapshotUrl !== null) {
      await coalesceSnapshotCaptureJob(tx, {
        projectId: input.projectId,
        payload: {
          projectId: input.projectId,
          url: project.snapshotUrl,
          requestId: randomUUID(),
        },
      });
    } else {
      await tx
        .update(jobs)
        .set({
          dedupeKey: null,
          maxAttempts: jobs.attempts,
          updatedAt: reconciledAt,
        })
        .where(eq(jobs.id, activeJob.id));
    }
    return true;
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

    if (!project) throw new SnapshotProjectNotFoundError(input.projectId);
    if (
      project.snapshotMode !== 'automatic'
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

    if (input.attemptedAt !== undefined) {
      const saved = await tx
        .update(projectSnapshots)
        .set(snapshot)
        .where(and(
          eq(projectSnapshots.projectId, input.projectId),
          eq(projectSnapshots.lastAttemptStatus, 'pending'),
          eq(projectSnapshots.lastAttemptAt, input.attemptedAt),
        ))
        .returning({ projectId: projectSnapshots.projectId });
      return saved.length > 0;
    }

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
    if (!project) throw new SnapshotProjectNotFoundError(input.projectId);

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
  expectedUrl: string,
  errorCode: SnapshotErrorCode,
  attemptedAt?: Date,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [project] = await tx
      .select({
        snapshotMode: projects.snapshotMode,
        snapshotUrl: projects.snapshotUrl,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for('update');
    if (!project) throw new SnapshotProjectNotFoundError(projectId);
    if (
      project.snapshotMode !== 'automatic'
      || project.snapshotUrl !== expectedUrl
    ) {
      return false;
    }

    const failedAt = new Date();
    if (attemptedAt !== undefined) {
      const failed = await tx
        .update(projectSnapshots)
        .set({
          lastAttemptAt: failedAt,
          lastAttemptStatus: 'failed',
          lastError: errorCode,
          updatedAt: failedAt,
        })
        .where(and(
          eq(projectSnapshots.projectId, projectId),
          eq(projectSnapshots.lastAttemptStatus, 'pending'),
          eq(projectSnapshots.lastAttemptAt, attemptedAt),
        ))
        .returning({ projectId: projectSnapshots.projectId });
      return failed.length > 0;
    }
    await tx
      .insert(projectSnapshots)
      .values({
        projectId,
        lastAttemptAt: failedAt,
        lastAttemptStatus: 'failed',
        lastError: errorCode,
        updatedAt: failedAt,
      })
      .onConflictDoUpdate({
        target: projectSnapshots.projectId,
        set: {
          lastAttemptAt: failedAt,
          lastAttemptStatus: 'failed',
          lastError: errorCode,
          updatedAt: failedAt,
        },
      });
    return true;
  });
}

export async function resumeAutomaticSnapshot(db: Db, projectId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [project] = await tx
      .select({
        snapshotMode: projects.snapshotMode,
        snapshotUrl: projects.snapshotUrl,
      })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for('update');
    if (!project) throw new SnapshotProjectNotFoundError(projectId);
    if (!project.snapshotUrl || project.snapshotMode === 'automatic') return false;

    await tx
      .update(projects)
      .set({ snapshotMode: 'automatic', updatedAt: new Date() })
      .where(eq(projects.id, projectId));
    return true;
  });
}

export async function deleteSnapshotImage(db: Db, projectId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [project] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.id, projectId))
      .for('update');
    if (!project) throw new SnapshotProjectNotFoundError(projectId);

    await tx
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
  });
}
