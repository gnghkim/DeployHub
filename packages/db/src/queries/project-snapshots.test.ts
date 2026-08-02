import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
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
import * as databaseSchema from '../schema';
import {
  deleteSnapshotImage,
  getSnapshotState,
  markSnapshotFailed,
  markSnapshotPending,
  resumeAutomaticSnapshot,
  saveAutomaticSnapshot,
  saveManualSnapshot,
  SnapshotProjectNotFoundError,
} from './project-snapshots';

let db: Db;
let stop: () => Promise<void>;
let connectionString: string;

beforeAll(async () => {
  const started = await startTestDb();
  db = started.db;
  stop = started.stop;
  connectionString = started.connectionString;
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

function openNamedDb(applicationName: string): {
  db: Db;
  close: () => Promise<void>;
} {
  const pool = new pg.Pool({ connectionString, application_name: applicationName });
  return {
    db: drizzle(pool, { schema: databaseSchema }),
    close: () => pool.end(),
  };
}

async function waitForDatabaseLock(applicationName: string): Promise<void> {
  for (let attempt = 0; attempt < 2_000; attempt += 1) {
    const result = await db.execute<{ waiting: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1
        FROM pg_stat_activity
        WHERE application_name = ${applicationName}
          AND wait_event_type = 'Lock'
      ) AS waiting
    `);
    if (result.rows[0]?.waiting) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`timed out waiting for database lock: ${applicationName}`);
}

async function holdProjectLock(projectId: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString });
  await client.connect();
  await client.query('BEGIN');
  await client.query('SELECT id FROM projects WHERE id = $1 FOR UPDATE', [projectId]);
  return client;
}

function automaticInput(projectId: string, overrides: {
  url?: string;
  imageData?: Buffer;
  checksum?: string;
  capturedAt?: Date;
} = {}) {
  return {
    projectId,
    url: overrides.url ?? 'https://example.com/app',
    imageData: overrides.imageData ?? Buffer.from('automatic-webp'),
    width: 1440,
    height: 900,
    checksum: overrides.checksum ?? 'automatic-checksum',
    capturedAt: overrides.capturedAt ?? new Date('2026-08-02T03:00:00.000Z'),
  };
}

function manualInput(projectId: string, overrides: {
  imageData?: Buffer;
  checksum?: string;
  capturedAt?: Date;
} = {}) {
  return {
    projectId,
    imageData: overrides.imageData ?? Buffer.from('manual-webp'),
    width: 1440,
    height: 900,
    checksum: overrides.checksum ?? 'manual-checksum',
    capturedAt: overrides.capturedAt ?? new Date('2026-08-02T04:00:00.000Z'),
  };
}

describe('project snapshot repository', () => {
  it('marks an attempt pending without requiring an existing snapshot row', async () => {
    const project = await insertProject();

    await expect(markSnapshotPending(
      db,
      project.id,
      'https://example.com/app',
    )).resolves.toBe(true);

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

  it('rejects an automatic snapshot when the expected URL no longer matches', async () => {
    const project = await insertProject();

    await expect(saveAutomaticSnapshot(db, automaticInput(project.id, {
      url: 'https://example.com/old-app',
    }))).resolves.toBe(false);
    await expect(getSnapshotState(db, project.id)).resolves.toBeUndefined();
  });

  it('rejects an automatic snapshot while snapshot mode is disabled', async () => {
    const project = await insertProject({ snapshotMode: 'disabled' });

    await expect(saveAutomaticSnapshot(db, automaticInput(project.id))).resolves.toBe(false);
    await expect(getSnapshotState(db, project.id)).resolves.toBeUndefined();
  });

  it('replaces an existing snapshot through the automatic upsert path', async () => {
    const project = await insertProject();
    await saveAutomaticSnapshot(db, automaticInput(project.id));

    await expect(saveAutomaticSnapshot(db, automaticInput(project.id, {
      imageData: Buffer.from('replacement-webp'),
      checksum: 'replacement-checksum',
      capturedAt: new Date('2026-08-02T06:00:00.000Z'),
    }))).resolves.toBe(true);

    expect(await getSnapshotState(db, project.id)).toMatchObject({
      imageData: Buffer.from('replacement-webp'),
      checksum: 'replacement-checksum',
      capturedAt: new Date('2026-08-02T06:00:00.000Z'),
      source: 'automatic',
      lastAttemptStatus: 'success',
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

    await expect(markSnapshotFailed(
      db,
      project.id,
      'https://example.com/app',
      'navigation_failed',
    )).resolves.toBe(true);

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

  it('does not mark a stale attempt pending after a manual upload wins', async () => {
    const project = await insertProject();
    await saveManualSnapshot(db, manualInput(project.id));
    const afterManual = await getSnapshotState(db, project.id);

    await expect(markSnapshotPending(
      db,
      project.id,
      'https://example.com/app',
    )).resolves.toBe(false);
    await expect(getSnapshotState(db, project.id)).resolves.toEqual(afterManual);
  });

  it('does not mark a stale attempt failed after the automatic URL changes', async () => {
    const project = await insertProject();
    await saveAutomaticSnapshot(db, automaticInput(project.id));
    const beforeUrlChange = await getSnapshotState(db, project.id);
    await db
      .update(schema.projects)
      .set({ snapshotUrl: 'https://example.com/new-app' })
      .where(eq(schema.projects.id, project.id));

    await expect(markSnapshotFailed(
      db,
      project.id,
      'https://example.com/app',
      'navigation_failed',
    )).resolves.toBe(false);
    await expect(getSnapshotState(db, project.id)).resolves.toEqual(beforeUrlChange);
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

    await expect(resumeAutomaticSnapshot(db, project.id)).resolves.toBe(true);

    const [projectAfterResume] = await db
      .select({ snapshotMode: schema.projects.snapshotMode })
      .from(schema.projects)
      .where(eq(schema.projects.id, project.id));
    expect(projectAfterResume?.snapshotMode).toBe('automatic');
    expect(await getSnapshotState(db, project.id)).toEqual(before);
  });

  it('does not resume automatic mode when the project has no snapshot URL', async () => {
    const project = await insertProject({ snapshotMode: 'disabled', snapshotUrl: null });
    await saveManualSnapshot(db, manualInput(project.id));

    await expect(resumeAutomaticSnapshot(db, project.id)).resolves.toBe(false);

    const [projectAfterResume] = await db
      .select({ snapshotMode: schema.projects.snapshotMode })
      .from(schema.projects)
      .where(eq(schema.projects.id, project.id));
    expect(projectAfterResume?.snapshotMode).toBe('manual');
  });

  it('does not report a mode update when the project is already automatic', async () => {
    const project = await insertProject();

    await expect(resumeAutomaticSnapshot(db, project.id)).resolves.toBe(false);

    const [projectAfterResume] = await db
      .select({ snapshotMode: schema.projects.snapshotMode })
      .from(schema.projects)
      .where(eq(schema.projects.id, project.id));
    expect(projectAfterResume?.snapshotMode).toBe('automatic');
  });

  it('deletes only current-image metadata while preserving mode and attempt audit fields', async () => {
    const project = await insertProject();
    await saveAutomaticSnapshot(db, automaticInput(project.id));
    await expect(markSnapshotFailed(
      db,
      project.id,
      'https://example.com/app',
      'render_failed',
    )).resolves.toBe(true);
    const beforeDelete = await getSnapshotState(db, project.id);

    await deleteSnapshotImage(db, project.id);

    const [projectAfterDelete] = await db
      .select({ snapshotMode: schema.projects.snapshotMode })
      .from(schema.projects)
      .where(eq(schema.projects.id, project.id));
    expect(projectAfterDelete?.snapshotMode).toBe('automatic');
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

  it('uses a typed not-found error consistently for project mutations', async () => {
    const missingProjectId = crypto.randomUUID();
    const mutations = [
      () => markSnapshotPending(db, missingProjectId, 'https://example.com/app'),
      () => markSnapshotFailed(
        db,
        missingProjectId,
        'https://example.com/app',
        'navigation_failed',
      ),
      () => saveAutomaticSnapshot(db, automaticInput(missingProjectId)),
      () => saveManualSnapshot(db, manualInput(missingProjectId)),
      () => resumeAutomaticSnapshot(db, missingProjectId),
      () => deleteSnapshotImage(db, missingProjectId),
    ];

    for (const mutate of mutations) {
      await expect(mutate()).rejects.toBeInstanceOf(SnapshotProjectNotFoundError);
    }
  });

  it('lets a queued manual save win before a queued automatic save rechecks mode', async () => {
    const project = await insertProject();
    const blocker = await holdProjectLock(project.id);
    const manual = openNamedDb('snapshot-manual-save-race');
    const automatic = openNamedDb('snapshot-automatic-save-race');
    let released = false;

    try {
      const manualSave = saveManualSnapshot(manual.db, manualInput(project.id));
      await waitForDatabaseLock('snapshot-manual-save-race');
      const automaticSave = saveAutomaticSnapshot(
        automatic.db,
        automaticInput(project.id, {
          imageData: Buffer.from('stale-automatic-webp'),
          checksum: 'stale-automatic-checksum',
        }),
      );
      await waitForDatabaseLock('snapshot-automatic-save-race');

      await blocker.query('COMMIT');
      released = true;

      await expect(manualSave).resolves.toBeUndefined();
      await expect(automaticSave).resolves.toBe(false);
      expect(await getSnapshotState(db, project.id)).toMatchObject({
        imageData: Buffer.from('manual-webp'),
        source: 'manual',
        checksum: 'manual-checksum',
        lastAttemptStatus: 'success',
      });
    } finally {
      if (!released) await blocker.query('ROLLBACK');
      await blocker.end();
      await manual.close();
      await automatic.close();
    }
  });

  it('blocks queued stale pending and failure writes after a manual save wins', async () => {
    const project = await insertProject();
    const blocker = await holdProjectLock(project.id);
    const manual = openNamedDb('snapshot-manual-attempt-race');
    const pending = openNamedDb('snapshot-pending-race');
    const failed = openNamedDb('snapshot-failed-race');
    let released = false;

    try {
      const manualSave = saveManualSnapshot(manual.db, manualInput(project.id));
      await waitForDatabaseLock('snapshot-manual-attempt-race');
      const pendingWrite = markSnapshotPending(
        pending.db,
        project.id,
        'https://example.com/app',
      );
      await waitForDatabaseLock('snapshot-pending-race');
      const failedWrite = markSnapshotFailed(
        failed.db,
        project.id,
        'https://example.com/app',
        'navigation_failed',
      );
      await waitForDatabaseLock('snapshot-failed-race');

      await blocker.query('COMMIT');
      released = true;

      await expect(manualSave).resolves.toBeUndefined();
      await expect(pendingWrite).resolves.toBe(false);
      await expect(failedWrite).resolves.toBe(false);
      expect(await getSnapshotState(db, project.id)).toMatchObject({
        imageData: Buffer.from('manual-webp'),
        source: 'manual',
        checksum: 'manual-checksum',
        lastAttemptStatus: 'success',
        lastError: null,
      });
    } finally {
      if (!released) await blocker.query('ROLLBACK');
      await blocker.end();
      await manual.close();
      await pending.close();
      await failed.close();
    }
  });
});
