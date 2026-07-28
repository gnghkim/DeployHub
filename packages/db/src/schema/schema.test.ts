import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { startTestDb } from '../../test/helpers/pg';
import { schema, type Db } from '../index';

let db: Db;
let stop: () => Promise<void>;

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
