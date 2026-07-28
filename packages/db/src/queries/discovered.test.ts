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
import { listDiscoveredStacks } from './discovered';

let db: Db;
let stop: () => Promise<void> = async () => {};

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
  await db.delete(schema.components);
  await db.delete(schema.projects);
});

async function insertResource(
  values: Partial<typeof schema.resources.$inferInsert> & {
    name: string;
    resourceType?: typeof schema.resources.$inferInsert.resourceType;
  },
) {
  const [resource] = await db
    .insert(schema.resources)
    .values({
      provider: values.resourceType === 'github_repository' ? 'github' : 'docker',
      externalId: `${values.resourceType ?? 'docker_container'}-${values.name}`,
      resourceType: 'docker_container',
      ...values,
    })
    .returning();
  return resource!;
}

describe('listDiscoveredStacks', () => {
  it('연결된 컨테이너가 하나라도 있는 스택 전체를 제외한다', async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({ name: 'DeployHub', slug: 'deployhub' })
      .returning();
    const [component] = await db
      .insert(schema.components)
      .values({
        projectId: project!.id,
        name: 'web',
        slug: 'web',
        componentType: 'frontend',
      })
      .returning();
    const linked = await insertResource({
      name: 'deployhub-web',
      metadata: { composeProject: 'deployhub', image: 'deployhub-web:latest' },
    });
    await insertResource({
      name: 'deployhub-socket-proxy',
      metadata: { composeProject: 'deployhub', image: 'tecnativa/docker-socket-proxy' },
    });
    await insertResource({
      name: 'workwiki-web',
      status: 'running',
      metadata: { composeProject: 'workwiki', image: 'workwiki:latest' },
    });
    await db.insert(schema.componentResources).values({
      componentId: component!.id,
      resourceId: linked.id,
      relationType: 'deployed_to',
      linkedBy: 'manifest',
    });

    const stacks = await listDiscoveredStacks(db);

    expect(stacks.map((stack) => stack.stack)).toEqual(['workwiki']);
  });

  it('저장소와 삭제된 컨테이너를 결과에서 제외한다', async () => {
    await insertResource({
      name: 'running-service',
      status: 'running',
      metadata: { composeProject: 'active' },
    });
    await insertResource({
      name: 'repository',
      resourceType: 'github_repository',
      metadata: { composeProject: 'repository' },
    });
    await insertResource({
      name: 'deleted-service',
      deletedAt: new Date(),
      metadata: { composeProject: 'deleted' },
    });

    const stacks = await listDiscoveredStacks(db);

    expect(stacks).toEqual([
      {
        stack: 'active',
        containers: [
          {
            name: 'running-service',
            image: null,
            status: 'running',
          },
        ],
      },
    ]);
  });

  it('그룹 없는 컨테이너를 한 그룹 안의 개별 항목으로 나열한다', async () => {
    await insertResource({
      name: 'ktgo-postgres',
      status: 'running',
      metadata: { image: 'postgres:16-alpine' },
    });
    await insertResource({
      name: 'standalone-worker',
      metadata: {},
    });

    const stacks = await listDiscoveredStacks(db);

    expect(stacks).toEqual([
      {
        stack: '(그룹 없음)',
        containers: [
          {
            name: 'ktgo-postgres',
            image: 'postgres:16-alpine',
            status: 'running',
          },
          {
            name: 'standalone-worker',
            image: null,
            status: null,
          },
        ],
      },
    ]);
  });

  it('스택과 컨테이너를 이름순으로 안정적으로 정렬한다', async () => {
    await insertResource({
      name: 'zeta-worker',
      metadata: { composeProject: 'zeta', image: 'zeta:latest' },
    });
    await insertResource({
      name: 'alpha-web',
      metadata: { composeProject: 'alpha', image: 'alpha-web:latest' },
    });
    await insertResource({
      name: 'alpha-api',
      metadata: { composeProject: 'alpha', image: 'alpha-api:latest' },
    });
    await insertResource({
      name: 'standalone',
      metadata: {},
    });

    const stacks = await listDiscoveredStacks(db);

    expect(stacks.map((stack) => stack.stack)).toEqual([
      'alpha',
      'zeta',
      '(그룹 없음)',
    ]);
    expect(stacks[0]?.containers.map((container) => container.name)).toEqual([
      'alpha-api',
      'alpha-web',
    ]);
  });
});
