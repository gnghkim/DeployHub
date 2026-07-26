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
  listProjectResources,
  listResources,
  listUnlinkedResources,
} from './resources';

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
  await db.delete(schema.componentResources);
  await db.delete(schema.resources);
  await db.delete(schema.projects);
});

async function seedResources() {
  const [project] = await db
    .insert(schema.projects)
    .values({ name: 'WorkWiki', slug: 'workwiki' })
    .returning();
  if (!project) throw new Error('project insert 실패');

  const [component] = await db
    .insert(schema.components)
    .values({
      projectId: project.id,
      name: 'web',
      slug: 'web',
      componentType: 'frontend',
    })
    .returning();
  if (!component) throw new Error('component insert 실패');

  const insertedResources = await db
    .insert(schema.resources)
    .values([
      {
        provider: 'github',
        externalId: 'ktgo/linked',
        resourceType: 'github_repository',
        name: 'linked',
      },
      {
        provider: 'github',
        externalId: 'ktgo/pending',
        resourceType: 'github_repository',
        name: 'pending',
      },
      {
        provider: 'github',
        externalId: 'ktgo/unlinked',
        resourceType: 'github_repository',
        name: 'unlinked',
      },
      {
        provider: 'github',
        externalId: 'ktgo/deleted',
        resourceType: 'github_repository',
        name: 'deleted',
        deletedAt: new Date(),
      },
    ])
    .returning();

  const linked = insertedResources.find(
    (resource) => resource.name === 'linked',
  );
  const pending = insertedResources.find(
    (resource) => resource.name === 'pending',
  );
  if (!linked || !pending) throw new Error('resource insert 실패');

  await db.insert(schema.componentResources).values([
    {
      componentId: component.id,
      resourceId: linked.id,
      relationType: 'uses',
      linkedBy: 'repository',
    },
    {
      componentId: component.id,
      resourceId: pending.id,
      relationType: 'uses',
      linkedBy: 'suggested',
    },
  ]);

  return { project, component };
}

describe('자원 조회', () => {
  it('수집된 활성 자원을 연결 프로젝트와 함께 돌려준다', async () => {
    await seedResources();

    const rows = await listResources(db);

    expect(rows.map((row) => row.name)).toEqual([
      'linked',
      'pending',
      'unlinked',
    ]);
    expect(rows[0]?.links[0]).toMatchObject({
      projectSlug: 'workwiki',
      linkedBy: 'repository',
    });
    expect(rows[1]?.links).toEqual([]);
  });

  it('suggested 행만 있는 자원도 미연결로 분류한다', async () => {
    await seedResources();

    const rows = await listUnlinkedResources(db);

    expect(rows.map((row) => row.name)).toEqual([
      'pending',
      'unlinked',
    ]);
  });

  it('프로젝트 상세에는 확정 연결만 돌려준다', async () => {
    const { project } = await seedResources();

    const rows = await listProjectResources(db, project.id);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: 'linked',
      linkedBy: 'repository',
    });
  });
});
