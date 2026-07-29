import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { startTestDb } from '../../test/helpers/pg';
import { schema, type Db } from '../index';
import * as databaseSchema from '../schema';
import {
  getProjectBySlug,
  listProjects,
  listProjectsWithSummaryData,
} from './projects';

let db: Db;
let stop: () => Promise<void>;
let countedDb: Db;
let closeCountedDb: () => Promise<void>;
let queryCount = 0;

beforeAll(async () => {
  const s = await startTestDb();
  db = s.db;
  stop = s.stop;
  const pool = new pg.Pool({ connectionString: s.connectionString });
  countedDb = drizzle(pool, {
    schema: databaseSchema,
    logger: {
      logQuery() {
        queryCount += 1;
      },
    },
  });
  closeCountedDb = () => pool.end();
}, 120_000);
afterAll(async () => {
  await closeCountedDb();
  await stop();
});
beforeEach(async () => {
  await db.delete(schema.changeEvents);
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
    expect(rows[0]?.judgement).toBe('정상');
  });

  it('프로젝트가 1개든 10개든 목록 요약은 정확히 5개 쿼리만 실행한다', async () => {
    await db.insert(schema.projects).values({ name: 'Project 1', slug: 'project-1' });

    queryCount = 0;
    await listProjectsWithSummaryData(countedDb);
    const oneProjectQueryCount = queryCount;

    await db.delete(schema.projects);
    await db.insert(schema.projects).values(Array.from(
      { length: 10 },
      (_, index) => ({
        name: `Project ${index + 1}`,
        slug: `project-${index + 1}`,
      }),
    ));

    queryCount = 0;
    await listProjectsWithSummaryData(countedDb);
    const tenProjectQueryCount = queryCount;

    expect(oneProjectQueryCount).toBe(5);
    expect(tenProjectQueryCount).toBe(oneProjectQueryCount);
  });

  describe('구성요소 관측', () => {
    beforeEach(async () => {
      const [project] = await db
        .insert(schema.projects)
        .values({ name: 'A', slug: 'a' })
        .returning();
      if (!project) throw new Error('project insert 실패');

      const [web] = await db
        .insert(schema.components)
        .values([
          {
            projectId: project.id,
            name: 'web',
            slug: 'web',
            componentType: 'frontend',
          },
          {
            projectId: project.id,
            name: 'worker',
            slug: 'worker',
            componentType: 'worker',
          },
        ])
        .returning();
      if (!web) throw new Error('component insert 실패');

      const [laterResource, firstResource] = await db
        .insert(schema.resources)
        .values([
          {
            provider: 'docker',
            externalId: 'container-z',
            resourceType: 'docker_container',
            name: 'z-deployhub-web',
            status: 'restarting',
          },
          {
            provider: 'docker',
            externalId: 'container-a',
            resourceType: 'docker_container',
            name: 'deployhub-web',
            status: 'running',
          },
        ])
        .returning();
      if (!laterResource || !firstResource) throw new Error('resource insert 실패');

      await db.insert(schema.componentResources).values([
        {
          componentId: web.id,
          resourceId: laterResource.id,
          relationType: 'runs_on',
          linkedBy: 'user',
        },
        {
          componentId: web.id,
          resourceId: firstResource.id,
          relationType: 'runs_on',
          linkedBy: 'user',
        },
      ]);
    });

    it('구성요소별 관측을 함께 낸다', async () => {
      const [project] = await listProjectsWithSummaryData(db);
      const web = project!.components.find((c) => c.slug === 'web');
      expect(project!.componentObservations.get(web!.id)).toEqual({
        name: 'deployhub-web',
        state: 'running',
      });
    });

    it('관측이 없는 구성요소는 키가 없다', async () => {
      const [project] = await listProjectsWithSummaryData(db);
      const worker = project!.components.find((c) => c.slug === 'worker');
      expect(project!.componentObservations.has(worker!.id)).toBe(false);
    });
  });

  it('추정 링크는 관측 provider와 구성요소 관측에서 제외한다', async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({ name: 'A', slug: 'a' })
      .returning();
    if (!project) throw new Error('project insert 실패');

    const [web] = await db
      .insert(schema.components)
      .values({
        projectId: project.id,
        name: 'web',
        slug: 'web',
        componentType: 'frontend',
      })
      .returning();
    if (!web) throw new Error('component insert 실패');

    const [resource] = await db
      .insert(schema.resources)
      .values({
        provider: 'docker',
        externalId: 'suggested-container',
        resourceType: 'docker_container',
        name: 'suggested-web',
        status: 'running',
      })
      .returning();
    if (!resource) throw new Error('resource insert 실패');

    await db.insert(schema.componentResources).values({
      componentId: web.id,
      resourceId: resource.id,
      relationType: 'runs_on',
      linkedBy: 'suggested',
    });

    const [summary] = await listProjectsWithSummaryData(db);

    expect(summary!.observedProviders).toEqual([]);
    expect(summary!.componentObservations.has(web.id)).toBe(false);
  });
});
