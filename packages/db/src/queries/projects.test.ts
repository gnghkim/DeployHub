import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDb } from '../../test/helpers/pg';
import { schema, type Db } from '../index';
import {
  getProjectBySlug,
  listProjects,
  listProjectsWithSummaryData,
} from './projects';

let db: Db;
let stop: () => Promise<void>;

beforeAll(async () => {
  const s = await startTestDb();
  db = s.db;
  stop = s.stop;
}, 120_000);
afterAll(async () => { await stop(); });
beforeEach(async () => {
  await db.delete(schema.deployments);
  await db.delete(schema.resources);
  await db.delete(schema.projects);
});

describe('프로젝트 조회', () => {
  it('보관되지 않은 프로젝트만 목록에 넣는다', async () => {
    await db.insert(schema.projects).values([
      { name: 'A', slug: 'a' },
      { name: 'B', slug: 'b', archivedAt: new Date() },
    ]);
    const rows = await listProjects(db);
    expect(rows.map((r) => r.slug)).toEqual(['a']);
  });

  it('slug 로 상세를 가져오고 구성요소를 함께 담는다', async () => {
    const [p] = await db.insert(schema.projects).values({ name: 'A', slug: 'a' }).returning();
    if (!p) throw new Error('insert 실패');
    await db.insert(schema.components).values({
      projectId: p.id, name: 'web', slug: 'web', componentType: 'frontend', framework: 'nextjs',
    });

    const detail = await getProjectBySlug(db, 'a');
    expect(detail?.name).toBe('A');
    expect(detail?.components).toHaveLength(1);
    expect(detail?.components[0]?.framework).toBe('nextjs');
  });

  it('없는 slug 는 undefined 를 돌려준다', async () => {
    expect(await getProjectBySlug(db, 'nope')).toBeUndefined();
  });

  it('repository 값을 저장하고 돌려준다', async () => {
    await db.insert(schema.projects).values({ name: 'A', slug: 'a', repository: 'ktgo/a' });
    const detail = await getProjectBySlug(db, 'a');
    expect(detail?.repository).toBe('ktgo/a');
  });

  it('목록 요약 재료와 프로젝트별 최신 배포 한 건을 함께 가져온다', async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({ name: 'A', slug: 'a' })
      .returning();
    if (!project) throw new Error('project insert 실패');

    const [web, database] = await db
      .insert(schema.components)
      .values([
        {
          projectId: project.id,
          name: 'web',
          slug: 'web',
          componentType: 'frontend',
          framework: 'nextjs',
          provider: 'vercel',
        },
        {
          projectId: project.id,
          name: 'database',
          slug: 'database',
          componentType: 'database',
          runtime: 'postgresql',
        },
      ])
      .returning();
    if (!web || !database) throw new Error('component insert 실패');

    const [resource] = await db
      .insert(schema.resources)
      .values({
        provider: 'docker',
        externalId: 'container-1',
        resourceType: 'docker_container',
        name: 'web',
      })
      .returning();
    if (!resource) throw new Error('resource insert 실패');

    await db.insert(schema.componentResources).values({
      componentId: web.id,
      resourceId: resource.id,
      relationType: 'runs_on',
      linkedBy: 'user',
    });

    const older = new Date('2026-07-28T01:00:00.000Z');
    const latest = new Date('2026-07-28T02:00:00.000Z');
    await db.insert(schema.deployments).values([
      {
        projectId: project.id,
        provider: 'vercel',
        environment: 'production',
        externalDeploymentId: 'deployment-old',
        status: 'ready',
        startedAt: older,
      },
      {
        projectId: project.id,
        provider: 'vercel',
        environment: 'production',
        externalDeploymentId: 'deployment-latest',
        status: 'ready',
        startedAt: latest,
      },
    ]);

    const rows = await listProjectsWithSummaryData(db);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.components.map((row) => row.componentType)).toEqual([
      'database',
      'frontend',
    ]);
    expect(rows[0]?.observedProviders).toEqual(['docker']);
    expect(rows[0]?.latestDeploymentAt).toEqual(latest);
  });
});
