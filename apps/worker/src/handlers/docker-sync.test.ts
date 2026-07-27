import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { asc, eq, sql } from 'drizzle-orm';
import { startTestDb } from '@deployhub/db/test/helpers/pg.js';
import {
  schema,
  type Db,
  type JobRecord,
} from '@deployhub/db';
import type {
  DockerCollector,
  DockerContainerSnapshot,
  ExternalDeployment,
  ExternalResource,
} from '@deployhub/collectors';
import {
  createDockerSyncHandler,
  enqueueDockerSyncJob,
} from './docker-sync';

const containerId =
  '3b27fe7ebf9b00000000000000000000000000000000000000000000000000000';
const missingContainerId =
  '4c38fe7ebf9b00000000000000000000000000000000000000000000000000000';
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
  await db.delete(schema.componentResources);
  await db.delete(schema.components);
  await db.delete(schema.resources);
  await db.delete(schema.projects);
  await db.delete(schema.jobs);
});

function job(): JobRecord {
  return {
    id: 'docker-job-id',
    type: 'docker.sync',
    payload: {},
    attempts: 1,
    maxAttempts: 3,
  };
}

function collector(
  resources: ExternalResource[],
  deployments: ExternalDeployment[],
  snapshots: DockerContainerSnapshot[],
): DockerCollector {
  return {
    provider: 'docker',
    testConnection: vi.fn(),
    listResources: vi.fn().mockResolvedValue(resources),
    listDeployments: vi.fn().mockResolvedValue(deployments),
    listSnapshots: vi.fn().mockResolvedValue(snapshots),
  };
}

describe('Docker sync handler', () => {
  it('links only exact manifest or label targets and preserves user decisions', async () => {
    const [project] = await db.insert(schema.projects).values({
      name: 'DeployHub',
      slug: 'deployhub',
    }).returning();
    const insertedComponents = await db.insert(schema.components).values([
      {
        projectId: project!.id,
        name: 'web',
        slug: 'web',
        componentType: 'frontend',
        provider: 'hostinger',
        containerName: 'deployhub-web',
      },
      {
        projectId: project!.id,
        name: 'user-target',
        slug: 'user-target',
        componentType: 'worker',
        provider: 'hostinger',
        containerName: 'deployhub-user',
      },
      {
        projectId: project!.id,
        name: 'chosen-by-user',
        slug: 'chosen-by-user',
        componentType: 'worker',
      },
      {
        projectId: project!.id,
        name: 'conflict-manifest',
        slug: 'conflict-manifest',
        componentType: 'worker',
        containerName: 'deployhub-conflict',
      },
      {
        projectId: project!.id,
        name: 'conflict-label',
        slug: 'conflict-label',
        componentType: 'worker',
      },
      {
        projectId: project!.id,
        name: 'label-only',
        slug: 'label-only',
        componentType: 'worker',
      },
    ]).returning();
    const componentBySlug = new Map(
      insertedComponents.map((component) => [component.slug, component]),
    );
    const [userResource] = await db.insert(schema.resources).values({
      provider: 'docker',
      externalId: 'container-user',
      resourceType: 'docker_container',
      name: 'deployhub-user',
      metadata: {},
    }).returning();
    await db.insert(schema.componentResources).values({
      componentId: componentBySlug.get('chosen-by-user')!.id,
      resourceId: userResource!.id,
      environment: 'production',
      relationType: 'deployed_to',
      isPrimary: true,
      linkedBy: 'user',
    });
    const [conflictResource] = await db.insert(schema.resources).values({
      provider: 'docker',
      externalId: 'container-conflict',
      resourceType: 'docker_container',
      name: 'deployhub-conflict',
      metadata: {},
    }).returning();
    await db.insert(schema.componentResources).values({
      componentId: componentBySlug.get('conflict-manifest')!.id,
      resourceId: conflictResource!.id,
      environment: 'production',
      relationType: 'deployed_to',
      isPrimary: true,
      linkedBy: 'manifest',
    });

    const resources: ExternalResource[] = [
      {
        provider: 'docker',
        externalId: 'container-exact',
        resourceType: 'docker_container',
        name: 'deployhub-web',
        metadata: {},
        observedAt: '2026-07-27T00:00:00.000Z',
      },
      {
        provider: 'docker',
        externalId: 'container-partial',
        resourceType: 'docker_container',
        name: 'deployhub-web-old',
        metadata: {},
        observedAt: '2026-07-27T00:00:00.000Z',
      },
      {
        provider: 'docker',
        externalId: 'container-user',
        resourceType: 'docker_container',
        name: 'deployhub-user',
        metadata: {},
        observedAt: '2026-07-27T00:00:00.000Z',
      },
      {
        provider: 'docker',
        externalId: 'container-conflict',
        resourceType: 'docker_container',
        name: 'deployhub-conflict',
        metadata: {
          labels: {
            'deployhub.project': 'deployhub',
            'deployhub.component': 'conflict-label',
          },
        },
        observedAt: '2026-07-27T00:00:00.000Z',
      },
      {
        provider: 'docker',
        externalId: 'container-label',
        resourceType: 'docker_container',
        name: 'unrelated-name',
        metadata: {
          labels: {
            'deployhub.component': 'label-only',
            'deployhub.environment': 'staging',
          },
        },
        observedAt: '2026-07-27T00:00:00.000Z',
      },
    ];

    await createDockerSyncHandler(
      db,
      'http://socket-proxy:2375',
      { createCollector: () => collector(resources, [], []) },
    )(job());

    const links = await db
      .select({
        externalId: schema.resources.externalId,
        componentSlug: schema.components.slug,
        environment: schema.componentResources.environment,
        linkedBy: schema.componentResources.linkedBy,
      })
      .from(schema.componentResources)
      .innerJoin(
        schema.resources,
        eq(schema.resources.id, schema.componentResources.resourceId),
      )
      .innerJoin(
        schema.components,
        eq(schema.components.id, schema.componentResources.componentId),
      )
      .orderBy(asc(schema.resources.externalId));

    expect(links).toEqual([
      {
        externalId: 'container-exact',
        componentSlug: 'web',
        environment: 'production',
        linkedBy: 'manifest',
      },
      {
        externalId: 'container-label',
        componentSlug: 'label-only',
        environment: 'staging',
        linkedBy: 'label',
      },
      {
        externalId: 'container-user',
        componentSlug: 'chosen-by-user',
        environment: 'production',
        linkedBy: 'user',
      },
    ]);
  });

  it('upserts observations, soft-deletes missing resources, and reuses a deployment row on restart', async () => {
    const [project] = await db.insert(schema.projects).values({
      name: 'DeployHub',
      slug: 'deployhub',
    }).returning();
    const [component] = await db.insert(schema.components).values({
      projectId: project!.id,
      name: 'Database',
      slug: 'database',
      componentType: 'database',
      provider: 'docker',
      externalRef: containerId,
    }).returning();
    const [current] = await db.insert(schema.resources).values({
      provider: 'docker',
      externalId: containerId,
      resourceType: 'docker_container',
      name: 'old-name',
      metadata: {},
      deletedAt: new Date('2026-01-01T00:00:00.000Z'),
    }).returning();
    await db.insert(schema.componentResources).values({
      componentId: component!.id,
      resourceId: current!.id,
      environment: 'production',
      relationType: 'deployed_to',
      isPrimary: true,
      linkedBy: 'manifest',
    });
    const [missing] = await db.insert(schema.resources).values({
      provider: 'docker',
      externalId: missingContainerId,
      resourceType: 'docker_container',
      name: 'missing',
      metadata: {},
    }).returning();
    await db.insert(schema.containerSnapshots).values([
      {
        resourceId: current!.id,
        cpuPct: 1,
        memBytes: 1,
        restartCount: 0,
        observedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
      },
      {
        resourceId: missing!.id,
        cpuPct: 2,
        memBytes: 2,
        restartCount: 0,
        observedAt: new Date(Date.now() - 13 * 24 * 60 * 60 * 1000),
      },
    ]);
    await db.insert(schema.deployments).values({
      provider: 'docker',
      externalDeploymentId: containerId,
      environment: 'production',
      status: 'restarting',
      startedAt: new Date('2026-07-26T10:00:00.000Z'),
    });
    const [clock] = await db.select({
      before: sql<Date>`now()`,
    }).from(schema.resources).limit(1);
    const resources: ExternalResource[] = [{
      provider: 'docker',
      externalId: containerId,
      resourceType: 'docker_container',
      name: 'deployhub-postgres',
      status: 'running',
      metadata: {
        image: 'postgres:17-alpine',
        restartCount: 2,
      },
      observedAt: '2000-01-01T00:00:00.000Z',
    }];
    const deployments: ExternalDeployment[] = [{
      resourceExternalId: containerId,
      externalDeploymentId: containerId,
      environment: 'production',
      status: 'running',
      imageName: 'postgres:17-alpine',
      startedAt: '2026-07-26T11:00:00.000Z',
      metadata: {},
    }];
    const snapshots: DockerContainerSnapshot[] = [{
      resourceExternalId: containerId,
      cpuPct: 25,
      memBytes: 4096,
      restartCount: 2,
    }];
    const createCollector = vi.fn(() =>
      collector(resources, deployments, snapshots)
    );

    await createDockerSyncHandler(
      db,
      'http://socket-proxy:2375',
      { createCollector },
    )(job());

    expect(createCollector).toHaveBeenCalledWith(
      'http://socket-proxy:2375',
    );
    const resourceRows = await db
      .select()
      .from(schema.resources)
      .orderBy(asc(schema.resources.externalId));
    expect(resourceRows).toHaveLength(2);
    expect(resourceRows[0]).toMatchObject({
      externalId: containerId,
      name: 'deployhub-postgres',
      deletedAt: null,
    });
    expect(resourceRows[0]!.lastSeenAt.getTime()).toBeGreaterThanOrEqual(
      new Date(clock!.before).getTime(),
    );
    expect(resourceRows[0]!.lastSeenAt).not.toEqual(
      new Date(resources[0]!.observedAt),
    );
    expect(resourceRows[1]!.externalId).toBe(missingContainerId);
    expect(resourceRows[1]!.deletedAt).toBeInstanceOf(Date);

    const snapshotRows = await db
      .select()
      .from(schema.containerSnapshots)
      .orderBy(asc(schema.containerSnapshots.cpuPct));
    expect(snapshotRows).toHaveLength(2);
    expect(snapshotRows[0]).toMatchObject({
      resourceId: missing!.id,
      cpuPct: 2,
    });
    expect(snapshotRows[1]).toMatchObject({
      resourceId: current!.id,
      cpuPct: 25,
      memBytes: 4096,
      restartCount: 2,
    });
    expect(snapshotRows[1]!.observedAt.getTime()).toBeGreaterThanOrEqual(
      new Date(clock!.before).getTime(),
    );

    const deploymentRows = await db.select().from(schema.deployments);
    expect(deploymentRows).toHaveLength(1);
    expect(deploymentRows[0]).toMatchObject({
      projectId: project!.id,
      componentId: component!.id,
      provider: 'docker',
      externalDeploymentId: containerId,
      environment: 'production',
      status: 'running',
      imageName: 'postgres:17-alpine',
      startedAt: new Date('2026-07-26T11:00:00.000Z'),
    });
  });

  it('quietly skips handling and enqueueing when DOCKER_HOST_URL is absent', async () => {
    const createCollector = vi.fn();

    await createDockerSyncHandler(db, undefined, {
      createCollector,
    })(job());
    await enqueueDockerSyncJob(db, undefined);

    expect(createCollector).not.toHaveBeenCalled();
    expect(await db.select().from(schema.jobs)).toEqual([]);
  });

  it('enqueues a Docker sync job when DOCKER_HOST_URL is configured', async () => {
    await enqueueDockerSyncJob(db, 'http://socket-proxy:2375');

    const queued = await db.select().from(schema.jobs);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      type: 'docker.sync',
      payload: {},
      status: 'pending',
    });
  });

  it('reduces collector failures to status and container count', async () => {
    const createCollector = vi.fn(() => ({
      ...collector([], [], []),
      listResources: vi.fn().mockRejectedValue(
        new Error(
          'Docker API http://DOCKER_URL_SECRET failed '
          + '(HTTP 503, 컨테이너 13건): DOCKER_BODY_SECRET',
        ),
      ),
    }));

    await expect(
      createDockerSyncHandler(
        db,
        'http://socket-proxy:2375',
        { createCollector },
      )(job()),
    ).rejects.toThrow(
      'Docker 동기화에 실패했습니다. (HTTP 503, 컨테이너 13건)',
    );
  });
});
