import { eq, sql } from 'drizzle-orm';
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
  pruneSnapshots,
  recordSnapshots,
  type SnapshotInput,
  upsertDeployment,
} from './observations';

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
  await db.delete(schema.deployments);
  await db.delete(schema.containerSnapshots);
  await db.delete(schema.resources);
  await db.delete(schema.projects);
});

async function seedContainerResource(externalId = 'container-1') {
  const [resource] = await db
    .insert(schema.resources)
    .values({
      provider: 'docker',
      externalId,
      resourceType: 'docker_container',
      name: externalId,
    })
    .returning();
  if (!resource) throw new Error('resource insert failed');
  return resource;
}

describe('observation queries', () => {
  it('accumulates snapshots for the same resource', async () => {
    const resource = await seedContainerResource();

    await recordSnapshots(db, [{
      resourceId: resource.id,
      cpuPct: 10.5,
      memBytes: 1024,
      restartCount: 0,
    }]);
    await recordSnapshots(db, [{
      resourceId: resource.id,
      cpuPct: 20.25,
      memBytes: 2048,
      restartCount: 1,
    }]);

    const rows = await db
      .select()
      .from(schema.containerSnapshots)
      .where(eq(schema.containerSnapshots.resourceId, resource.id));
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.cpuPct).sort((a, b) => a - b)).toEqual([
      10.5,
      20.25,
    ]);
  });

  it('uses the database now() default for observed_at', async () => {
    const resource = await seedContainerResource();
    const appTimestamp = new Date('2000-01-01T00:00:00.000Z');
    const [clock] = await db.select({
      before: sql<Date>`now()`,
    }).from(schema.resources).limit(1);

    await recordSnapshots(db, [{
      resourceId: resource.id,
      cpuPct: 1,
      memBytes: 2,
      restartCount: 3,
      observedAt: appTimestamp,
    } as SnapshotInput & { observedAt: Date }]);

    const [snapshot] = await db
      .select()
      .from(schema.containerSnapshots)
      .where(eq(schema.containerSnapshots.resourceId, resource.id));
    expect(snapshot?.observedAt.getTime()).toBeGreaterThanOrEqual(
      new Date(clock?.before ?? 0).getTime(),
    );
    expect(snapshot?.observedAt).not.toEqual(appTimestamp);
  });

  it('prunes only snapshots older than the retention window', async () => {
    const resource = await seedContainerResource();
    const old = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);
    const recent = new Date(Date.now() - 13 * 24 * 60 * 60 * 1000);
    await db.insert(schema.containerSnapshots).values([
      {
        resourceId: resource.id,
        cpuPct: 1,
        memBytes: 1,
        restartCount: 0,
        observedAt: old,
      },
      {
        resourceId: resource.id,
        cpuPct: 2,
        memBytes: 2,
        restartCount: 0,
        observedAt: recent,
      },
    ]);

    const deleted = await pruneSnapshots(db, 14);

    const remaining = await db.select().from(schema.containerSnapshots);
    expect(deleted).toBe(1);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.cpuPct).toBe(2);
  });

  it('cascade deletes snapshots with their resource', async () => {
    const resource = await seedContainerResource();
    await recordSnapshots(db, [{
      resourceId: resource.id,
      cpuPct: 1,
      memBytes: 2,
      restartCount: 0,
    }]);

    await db.delete(schema.resources).where(eq(schema.resources.id, resource.id));

    const rows = await db.select().from(schema.containerSnapshots);
    expect(rows).toEqual([]);
  });

  it('upserts a deployment by provider and external deployment id', async () => {
    await upsertDeployment(db, {
      provider: 'vercel',
      externalDeploymentId: 'dpl_123',
      environment: 'production',
      status: 'building',
      version: 'v1',
    });
    await upsertDeployment(db, {
      provider: 'vercel',
      externalDeploymentId: 'dpl_123',
      environment: 'production',
      status: 'ready',
      version: 'v2',
    });

    const rows = await db.select().from(schema.deployments);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'ready', version: 'v2' });
  });

  it('allows a deployment without a project id', async () => {
    await upsertDeployment(db, {
      provider: 'docker',
      externalDeploymentId: 'container-1',
      environment: 'production',
      status: 'running',
    });

    const [deployment] = await db.select().from(schema.deployments);
    expect(deployment?.projectId).toBeNull();
  });
});
