import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { startTestDb } from '../../test/helpers/pg';
import {
  schema,
  type Db,
} from '../index';
import { computeDrift } from './drift';

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
  await db.delete(schema.components);
  await db.delete(schema.projects);
});

async function insertProject(slug = 'deployhub') {
  const [project] = await db
    .insert(schema.projects)
    .values({ name: slug, slug })
    .returning();
  return project!;
}

async function insertComponent(
  projectId: string,
  values: Partial<typeof schema.components.$inferInsert> = {},
) {
  const name = values.name ?? 'web';
  const [component] = await db
    .insert(schema.components)
    .values({
      projectId,
      name,
      slug: values.slug ?? name,
      componentType: 'frontend',
      ...values,
    })
    .returning();
  return component!;
}

async function insertDockerResource(
  name: string,
  metadata: Record<string, unknown> = {},
) {
  const [resource] = await db
    .insert(schema.resources)
    .values({
      provider: 'docker',
      externalId: `container-${name}`,
      resourceType: 'docker_container',
      name,
      metadata,
    })
    .returning();
  return resource!;
}

async function link(
  componentId: string,
  resourceId: string,
  linkedBy: typeof schema.componentResources.$inferInsert.linkedBy = 'manifest',
) {
  await db.insert(schema.componentResources).values({
    componentId,
    resourceId,
    environment: 'production',
    relationType: 'deployed_to',
    isPrimary: true,
    linkedBy,
  });
}

describe('computeDrift', () => {
  it('선언한 컨테이너가 없으면 declared_not_observed를 계산한다', async () => {
    const project = await insertProject();
    const component = await insertComponent(project.id, {
      provider: 'docker',
      containerName: 'foo',
    });

    const drift = await computeDrift(db, project.id);

    expect(drift).toEqual([
      expect.objectContaining({
        kind: 'declared_not_observed',
        projectId: project.id,
        componentId: component.id,
        declared: 'foo',
        observed: null,
      }),
    ]);
  });

  it('프로젝트에 연결됐지만 manifest에 없는 컨테이너를 observed_not_declared로 계산한다', async () => {
    const project = await insertProject();
    const component = await insertComponent(project.id, {
      provider: 'docker',
    });
    const resource = await insertDockerResource('foo');
    await link(component.id, resource.id, 'label');

    const drift = await computeDrift(db, project.id);

    expect(drift).toEqual([
      expect.objectContaining({
        kind: 'observed_not_declared',
        projectId: project.id,
        componentId: component.id,
        declared: null,
        observed: 'foo',
      }),
    ]);
  });

  it('supabase 선언에 Docker 컨테이너만 연결되면 provider_mismatch를 계산한다', async () => {
    const project = await insertProject();
    const component = await insertComponent(project.id, {
      provider: 'supabase',
      containerName: 'foo',
    });
    const resource = await insertDockerResource('foo');
    await link(component.id, resource.id, 'user');

    const drift = await computeDrift(db, project.id);

    expect(drift).toEqual([
      expect.objectContaining({
        kind: 'provider_mismatch',
        projectId: project.id,
        componentId: component.id,
        declared: 'supabase',
        observed: 'docker',
      }),
    ]);
  });

  it('선언과 연결된 관측이 정확히 일치하면 Drift가 없다', async () => {
    const project = await insertProject();
    const component = await insertComponent(project.id, {
      provider: 'docker',
      containerName: 'foo',
    });
    const resource = await insertDockerResource('foo');
    await link(component.id, resource.id);

    await expect(computeDrift(db, project.id)).resolves.toEqual([]);
  });

  it('어떤 프로젝트에도 연결되지 않은 자원을 observed_not_declared로 세지 않는다', async () => {
    const project = await insertProject();
    const component = await insertComponent(project.id, {
      provider: 'docker',
      containerName: 'foo',
    });
    const resource = await insertDockerResource('foo');
    await link(component.id, resource.id);
    await insertDockerResource('another-project-container');

    await expect(computeDrift(db, project.id)).resolves.toEqual([]);
  });

  it('manifest와 라벨 대상이 다르면 미연결 상태를 link_conflict로 계산한다', async () => {
    const project = await insertProject();
    const manifestComponent = await insertComponent(project.id, {
      name: 'web',
      slug: 'web',
      provider: 'hostinger',
      containerName: 'deployhub-web',
    });
    await insertComponent(project.id, {
      name: 'web-old',
      slug: 'web-old',
      provider: 'hostinger',
    });
    await insertDockerResource('deployhub-web', {
      labels: {
        'deployhub.project': 'deployhub',
        'deployhub.component': 'web-old',
      },
    });

    const drift = await computeDrift(db, project.id);

    expect(drift).toEqual([
      expect.objectContaining({
        kind: 'link_conflict',
        projectId: project.id,
        componentId: manifestComponent.id,
        declared: 'web',
        observed: 'web-old',
        detail: expect.stringMatching(
          /deployhub-web.*web.*web-old/,
        ),
      }),
    ]);
  });
});
