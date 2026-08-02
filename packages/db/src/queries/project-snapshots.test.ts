import { eq } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { startTestDb } from '../../test/helpers/pg';
import { schema, type Db } from '../index';
import {
  deleteSnapshotImage,
  getSnapshotState,
  markSnapshotFailed,
  markSnapshotPending,
  resumeAutomaticSnapshot,
  saveAutomaticSnapshot,
  saveManualSnapshot,
} from './project-snapshots';

let db: Db;
let stop: () => Promise<void>;

beforeAll(async () => {
  const started = await startTestDb();
  db = started.db;
  stop = started.stop;
}, 120_000);

afterAll(async () => {
  await stop();
});

beforeEach(async () => {
  await db.delete(schema.projects);
});

async function insertProject(
  overrides: Partial<typeof schema.projects.$inferInsert> = {},
): Promise<typeof schema.projects.$inferSelect> {
  const [project] = await db
    .insert(schema.projects)
    .values({
      name: 'Snapshot project',
      slug: `snapshot-${crypto.randomUUID()}`,
      snapshotMode: 'automatic',
      snapshotUrl: 'https://example.com/app',
      ...overrides,
    })
    .returning();
  if (!project) throw new Error('project insert failed');
  return project;
}

describe('project snapshot repository', () => {
  it('marks an attempt pending without requiring an existing snapshot row', async () => {
    const project = await insertProject();

    await markSnapshotPending(db, project.id);

    const state = await getSnapshotState(db, project.id);
    expect(state).toMatchObject({
      projectId: project.id,
      imageData: null,
      lastAttemptStatus: 'pending',
      lastError: null,
    });
    expect(state?.lastAttemptAt).toBeInstanceOf(Date);
  });

  it('saves an automatic snapshot when project mode and URL still match', async () => {
    const project = await insertProject();
    const [deployment] = await db
      .insert(schema.deployments)
      .values({
        projectId: project.id,
        provider: 'vercel',
        environment: 'production',
        externalDeploymentId: 'snapshot-deployment',
        status: 'ready',
      })
      .returning();
    if (!deployment) throw new Error('deployment insert failed');
    const capturedAt = new Date('2026-08-02T03:00:00.000Z');
    const imageData = Buffer.from('automatic-webp');

    await expect(saveAutomaticSnapshot(db, {
      projectId: project.id,
      url: 'https://example.com/app',
      imageData,
      width: 1440,
      height: 900,
      deploymentId: deployment.id,
      checksum: 'automatic-checksum',
      capturedAt,
    })).resolves.toBe(true);

    expect(await getSnapshotState(db, project.id)).toMatchObject({
      projectId: project.id,
      imageData,
      contentType: 'image/webp',
      width: 1440,
      height: 900,
      source: 'automatic',
      sourceUrl: 'https://example.com/app',
      deploymentId: deployment.id,
      checksum: 'automatic-checksum',
      capturedAt,
      lastAttemptStatus: 'success',
      lastError: null,
    });
  });

  it('preserves the current image and its metadata when an attempt fails', async () => {
    const project = await insertProject();
    const capturedAt = new Date('2026-08-02T03:00:00.000Z');
    const imageData = Buffer.from('current-webp');
    await saveAutomaticSnapshot(db, {
      projectId: project.id,
      url: 'https://example.com/app',
      imageData,
      width: 1440,
      height: 900,
      checksum: 'current-checksum',
      capturedAt,
    });

    await markSnapshotFailed(db, project.id, 'navigation_failed');

    expect(await getSnapshotState(db, project.id)).toMatchObject({
      imageData,
      contentType: 'image/webp',
      width: 1440,
      height: 900,
      source: 'automatic',
      sourceUrl: 'https://example.com/app',
      checksum: 'current-checksum',
      capturedAt,
      lastAttemptStatus: 'failed',
      lastError: 'navigation_failed',
    });
  });

  it('atomically pins a manual image and rejects a stale automatic result', async () => {
    const project = await insertProject();
    const manualCapturedAt = new Date('2026-08-02T04:00:00.000Z');
    const manualImage = Buffer.from('manual-webp');

    await saveManualSnapshot(db, {
      projectId: project.id,
      imageData: manualImage,
      width: 1440,
      height: 900,
      checksum: 'manual-checksum',
      capturedAt: manualCapturedAt,
    });

    const [afterManual] = await db
      .select({ snapshotMode: schema.projects.snapshotMode })
      .from(schema.projects)
      .where(eq(schema.projects.id, project.id));
    expect(afterManual?.snapshotMode).toBe('manual');
    expect(await getSnapshotState(db, project.id)).toMatchObject({
      imageData: manualImage,
      contentType: 'image/webp',
      width: 1440,
      height: 900,
      source: 'manual',
      sourceUrl: null,
      deploymentId: null,
      checksum: 'manual-checksum',
      capturedAt: manualCapturedAt,
      lastAttemptStatus: 'success',
      lastError: null,
    });

    await expect(saveAutomaticSnapshot(db, {
      projectId: project.id,
      url: 'https://example.com/app',
      imageData: Buffer.from('stale-automatic-webp'),
      width: 1440,
      height: 900,
      checksum: 'stale-checksum',
      capturedAt: new Date('2026-08-02T05:00:00.000Z'),
    })).resolves.toBe(false);
    expect(await getSnapshotState(db, project.id)).toMatchObject({
      imageData: manualImage,
      source: 'manual',
      checksum: 'manual-checksum',
      capturedAt: manualCapturedAt,
    });
  });

  it('resumes automatic mode without clearing the manual image', async () => {
    const project = await insertProject();
    const capturedAt = new Date('2026-08-02T04:00:00.000Z');
    await saveManualSnapshot(db, {
      projectId: project.id,
      imageData: Buffer.from('manual-webp'),
      width: 1440,
      height: 900,
      checksum: 'manual-checksum',
      capturedAt,
    });
    const before = await getSnapshotState(db, project.id);

    await resumeAutomaticSnapshot(db, project.id);

    const [projectAfterResume] = await db
      .select({ snapshotMode: schema.projects.snapshotMode })
      .from(schema.projects)
      .where(eq(schema.projects.id, project.id));
    expect(projectAfterResume?.snapshotMode).toBe('automatic');
    expect(await getSnapshotState(db, project.id)).toEqual(before);
  });

  it('deletes only current-image metadata while preserving mode and attempt audit fields', async () => {
    const project = await insertProject();
    await saveManualSnapshot(db, {
      projectId: project.id,
      imageData: Buffer.from('manual-webp'),
      width: 1440,
      height: 900,
      checksum: 'manual-checksum',
      capturedAt: new Date('2026-08-02T04:00:00.000Z'),
    });
    await markSnapshotFailed(db, project.id, 'render_failed');
    const beforeDelete = await getSnapshotState(db, project.id);

    await deleteSnapshotImage(db, project.id);

    const [projectAfterDelete] = await db
      .select({ snapshotMode: schema.projects.snapshotMode })
      .from(schema.projects)
      .where(eq(schema.projects.id, project.id));
    expect(projectAfterDelete?.snapshotMode).toBe('manual');
    expect(await getSnapshotState(db, project.id)).toMatchObject({
      imageData: null,
      contentType: null,
      width: null,
      height: null,
      source: null,
      sourceUrl: null,
      deploymentId: null,
      checksum: null,
      capturedAt: null,
      lastAttemptAt: beforeDelete?.lastAttemptAt,
      lastAttemptStatus: 'failed',
      lastError: 'render_failed',
    });
  });

  it('cascade deletes snapshot state with its project', async () => {
    const project = await insertProject();
    await saveManualSnapshot(db, {
      projectId: project.id,
      imageData: Buffer.from('manual-webp'),
      width: 1440,
      height: 900,
      checksum: 'manual-checksum',
      capturedAt: new Date('2026-08-02T04:00:00.000Z'),
    });

    await db.delete(schema.projects).where(eq(schema.projects.id, project.id));

    await expect(getSnapshotState(db, project.id)).resolves.toBeUndefined();
  });
});
