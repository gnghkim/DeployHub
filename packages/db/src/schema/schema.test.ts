import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { startTestDb } from '../../test/helpers/pg';
import { schema, type Db } from '../index';

let db: Db;
let stop: () => Promise<void>;

describe('project snapshot schema', () => {
  it('defines the snapshot enums with the approved values', async () => {
    const result = await db.execute<{ name: string; values: string[] }>(`
      SELECT t.typname AS name,
             array_agg(e.enumlabel::text ORDER BY e.enumsortorder) AS values
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
      WHERE t.typname IN ('snapshot_mode', 'snapshot_source', 'snapshot_attempt_status')
      GROUP BY t.typname
      ORDER BY t.typname
    `);

    expect(result.rows).toEqual([
      { name: 'snapshot_attempt_status', values: ['pending', 'success', 'failed'] },
      { name: 'snapshot_mode', values: ['disabled', 'automatic', 'manual'] },
      { name: 'snapshot_source', values: ['automatic', 'manual'] },
    ]);
  });

  it('stores the project snapshot URL and defaults snapshot mode to disabled', async () => {
    const result = await db.execute<{ snapshot_url: string; snapshot_mode: string }>(`
      INSERT INTO projects (name, slug, snapshot_url)
      VALUES ('Snapshot fields', 'snapshot-fields', 'https://example.com/app')
      RETURNING snapshot_url, snapshot_mode
    `);

    expect(result.rows[0]).toEqual({
      snapshot_url: 'https://example.com/app',
      snapshot_mode: 'disabled',
    });
  });

  it('uses project_id as the one-to-one snapshot primary key', async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({ name: 'One snapshot', slug: 'one-snapshot' })
      .returning();
    if (!project) throw new Error('project insert failed');

    const imageData = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    await db.insert(schema.projectSnapshots).values({
      projectId: project.id,
      imageData,
      contentType: 'image/png',
      width: 1200,
      height: 630,
      source: 'manual',
    });

    const [snapshot] = await db
      .select()
      .from(schema.projectSnapshots)
      .where(eq(schema.projectSnapshots.projectId, project.id));
    expect(snapshot?.imageData).toEqual(imageData);
    type ProjectSnapshotRow = typeof schema.projectSnapshots.$inferSelect;
    expectTypeOf<ProjectSnapshotRow['imageData']>().toEqualTypeOf<Buffer | null>();

    await expect(
      db.insert(schema.projectSnapshots).values({ projectId: project.id }),
    ).rejects.toThrow();
  });

  it('cascade deletes the snapshot with its project', async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({ name: 'Cascade snapshot', slug: 'cascade-snapshot' })
      .returning();
    if (!project) throw new Error('project insert failed');

    await db.insert(schema.projectSnapshots).values({ projectId: project.id });
    await db.delete(schema.projects).where(eq(schema.projects.id, project.id));

    const remaining = await db
      .select()
      .from(schema.projectSnapshots)
      .where(eq(schema.projectSnapshots.projectId, project.id));
    expect(remaining).toHaveLength(0);
  });

  it('allows a null deployment foreign key and clears it when deployment is deleted', async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({ name: 'Deployment snapshot', slug: 'deployment-snapshot' })
      .returning();
    if (!project) throw new Error('project insert failed');

    const [snapshot] = await db
      .insert(schema.projectSnapshots)
      .values({ projectId: project.id })
      .returning();
    expect(snapshot?.deploymentId).toBeNull();

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

    await db
      .update(schema.projectSnapshots)
      .set({ deploymentId: deployment.id })
      .where(eq(schema.projectSnapshots.projectId, project.id));
    await db.delete(schema.deployments).where(eq(schema.deployments.id, deployment.id));

    const [afterDelete] = await db
      .select()
      .from(schema.projectSnapshots)
      .where(eq(schema.projectSnapshots.projectId, project.id));
    expect(afterDelete?.deploymentId).toBeNull();
  });
});

describe('change_events schema', () => {
  it('rejects unsupported severity values', async () => {
    await expect(
      db.execute(
        `INSERT INTO change_events (kind, severity, current_value, detail) VALUES ('health_status', 'urgent', 'ok', 'test')`,
      ),
    ).rejects.toThrow();
  });

  it('permits a global event with all target IDs null', async () => {
    await db.execute(
      `INSERT INTO change_events (project_id, component_id, resource_id, kind, severity, current_value, detail) VALUES (NULL, NULL, NULL, 'health_status', 'info', 'ok', 'test')`,
    );

    const result = await db.execute<{
      project_id: string | null;
      component_id: string | null;
      resource_id: string | null;
    }>(`SELECT project_id, component_id, resource_id FROM change_events`);
    expect(result.rows).toEqual([{
      project_id: null,
      component_id: null,
      resource_id: null,
    }]);
  });

  it('notified_at defaults to null', async () => {
    const result = await db.execute<{ notified_at: Date | null }>(
      `INSERT INTO change_events (kind, severity, current_value, detail) VALUES ('health_status', 'info', 'ok', 'test') RETURNING notified_at`,
    );
    expect(result.rows[0]?.notified_at).toBeNull();
  });

  it('occurred_at is assigned by database clock_timestamp()', async () => {
    const appTimestamp = new Date('2000-01-01T00:00:00.000Z');
    await db.transaction(async (tx) => {
      const clock = await tx.execute<{ before: Date }>(
        `SELECT clock_timestamp() AS before`,
      );
      await tx.execute(`SELECT pg_sleep(0.01)`);
      const result = await tx.execute<{ occurred_at: Date }>(
        `INSERT INTO change_events (kind, severity, current_value, detail) VALUES ('health_status', 'info', 'ok', 'test') RETURNING occurred_at`,
      );

      expect(new Date(result.rows[0]?.occurred_at ?? 0).getTime()).toBeGreaterThan(
        new Date(clock.rows[0]?.before ?? 0).getTime(),
      );
      expect(new Date(result.rows[0]?.occurred_at ?? 0)).not.toEqual(appTimestamp);
    });
  });
});

beforeAll(async () => {
  const started = await startTestDb();
  db = started.db;
  stop = started.stop;
}, 120_000);

afterAll(async () => {
  await stop();
});

describe('스키마 v1', () => {
  it('프로젝트를 삭제하면 구성요소도 함께 삭제된다', async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({ name: 'LinkVault', slug: 'linkvault' })
      .returning();
    if (!project) throw new Error('project insert 실패');

    await db.insert(schema.components).values({
      projectId: project.id,
      name: 'web',
      slug: 'web',
      componentType: 'frontend',
    });

    await db.delete(schema.projects).where(eq(schema.projects.id, project.id));

    const remaining = await db
      .select()
      .from(schema.components)
      .where(eq(schema.components.projectId, project.id));
    expect(remaining).toHaveLength(0);
  });

  it('같은 프로젝트 안에서 구성요소 slug가 중복되면 거부한다', async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({ name: 'WorkWiki', slug: 'workwiki' })
      .returning();
    if (!project) throw new Error('project insert 실패');

    await db.insert(schema.components).values({
      projectId: project.id, name: 'web', slug: 'web', componentType: 'frontend',
    });

    await expect(
      db.insert(schema.components).values({
        projectId: project.id, name: 'web2', slug: 'web', componentType: 'api',
      }),
    ).rejects.toThrow();
  });

  it('provider와 external_id 조합이 중복되면 거부한다', async () => {
    await db.insert(schema.resources).values({
      provider: 'github', externalId: 'ktgo/workwiki',
      resourceType: 'github_repository', name: 'workwiki',
    });

    await expect(
      db.insert(schema.resources).values({
        provider: 'github', externalId: 'ktgo/workwiki',
        resourceType: 'github_repository', name: 'workwiki-dup',
      }),
    ).rejects.toThrow();
  });

  it('provider_account 없이 자원을 저장할 수 있다', async () => {
    const [resource] = await db
      .insert(schema.resources)
      .values({
        provider: 'docker', externalId: 'container-abc123',
        resourceType: 'docker_container', name: 'deployhub-web',
      })
      .returning();
    expect(resource?.providerAccountId).toBeNull();
  });

  it('enum 밖의 값은 거부한다', async () => {
    await expect(
      db.execute(
        `INSERT INTO projects (name, slug, status) VALUES ('X', 'x-invalid', 'zombie')`,
      ),
    ).rejects.toThrow();
  });
});
