import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { startTestDb } from '@deployhub/db/test/helpers/pg.js';
import {
  schema,
  type Db,
  type JobRecord,
} from '@deployhub/db';
import type {
  ContainerStatus,
  DockerCollector,
} from '@deployhub/collectors';
import {
  createDockerHealthHandler,
  DOCKER_HEALTH_INTERVAL_MS,
  enqueueDockerHealthJob,
} from './docker-health';

const containerId = 'a'.repeat(64);
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
  await db.delete(schema.changeEvents);
  await db.delete(schema.componentResources);
  await db.delete(schema.components);
  await db.delete(schema.resources);
  await db.delete(schema.projects);
  await db.delete(schema.jobs);
});

function job(): JobRecord {
  return {
    id: 'docker-health-job-id',
    type: 'docker.health',
    payload: {},
    attempts: 1,
    maxAttempts: 3,
  };
}

async function insertResource(
  externalId: string = containerId,
  values: {
    provider?: 'docker' | 'vercel';
    deletedAt?: Date | null;
  } = {},
): Promise<string> {
  const [resource] = await db.insert(schema.resources).values({
    provider: values.provider ?? 'docker',
    externalId,
    resourceType: 'docker_container',
    name: `container-${externalId.slice(0, 4)}`,
    status: 'running',
    metadata: { preserved: true },
    lastSeenAt: new Date('2026-07-28T00:00:00.000Z'),
    deletedAt: values.deletedAt ?? null,
  }).returning({ id: schema.resources.id });
  return resource!.id;
}

async function linkResource(
  resourceId: string,
  slug: string,
  archivedAt: Date | null = null,
  options: {
    isPrimary?: boolean;
    linkedBy?: 'user' | 'manifest' | 'label' | 'suggested';
  } = {},
): Promise<{ projectId: string; componentId: string }> {
  const [project] = await db.insert(schema.projects).values({
    name: slug,
    slug,
    archivedAt,
  }).returning({ id: schema.projects.id });
  const [component] = await db.insert(schema.components).values({
    projectId: project!.id,
    name: `${slug}-component`,
    slug: `${slug}-component`,
    componentType: 'worker',
  }).returning({ id: schema.components.id });
  await db.insert(schema.componentResources).values({
    componentId: component!.id,
    resourceId,
    environment: 'production',
    relationType: 'deployed_to',
    isPrimary: options.isPrimary ?? true,
    linkedBy: options.linkedBy ?? 'user',
  });
  return {
    projectId: project!.id,
    componentId: component!.id,
  };
}

function status(
  externalId: string,
  state: string,
  dockerStatus: string = 'Up 1 minute',
): ContainerStatus {
  return {
    externalId,
    name: `container-${externalId.slice(0, 4)}`,
    state,
    status: dockerStatus,
  };
}

function collectorFactory(
  getStatuses: () => ContainerStatus[],
): {
  createCollector: () => Pick<DockerCollector, 'listContainerStatuses'>;
  listContainerStatuses: ReturnType<typeof vi.fn>;
} {
  const listContainerStatuses = vi.fn(
    async () => getStatuses(),
  );
  return {
    createCollector: () => ({ listContainerStatuses }),
    listContainerStatuses,
  };
}

describe('Docker health handler', () => {
  it('runs on a one-minute interval', () => {
    expect(DOCKER_HEALTH_INTERVAL_MS).toBe(60 * 1_000);
  });

  it('quietly succeeds without handling or enqueueing when DOCKER_HOST_URL is absent', async () => {
    const dependencies = collectorFactory(() => []);

    await expect(
      createDockerHealthHandler(
        db,
        undefined,
        dependencies,
      )(job()),
    ).resolves.toBeUndefined();
    await enqueueDockerHealthJob(db, '   ');

    expect(dependencies.listContainerStatuses).not.toHaveBeenCalled();
    expect(await db.select().from(schema.changeEvents)).toEqual([]);
    expect(await db.select().from(schema.jobs)).toEqual([]);
  });

  it('does not record an event when container state is unchanged', async () => {
    await insertResource();
    const dependencies = collectorFactory(
      () => [status(containerId, 'running')],
    );
    const handler = createDockerHealthHandler(
      db,
      'http://socket-proxy:2375',
      dependencies,
    );

    await handler(job());
    await handler(job());

    expect(await db.select().from(schema.changeEvents)).toMatchObject([
      {
        kind: 'container_status',
        currentValue: 'running',
      },
    ]);
    expect(dependencies.listContainerStatuses).toHaveBeenCalledTimes(2);
  });

  it('records running to exited to running as three state events', async () => {
    await insertResource();
    let currentState = 'running';
    const dependencies = collectorFactory(
      () => [status(containerId, currentState)],
    );
    const handler = createDockerHealthHandler(
      db,
      'http://socket-proxy:2375',
      dependencies,
    );

    await handler(job());
    currentState = 'exited';
    await handler(job());
    currentState = 'running';
    await handler(job());

    expect(
      await db
        .select({
          currentValue: schema.changeEvents.currentValue,
          severity: schema.changeEvents.severity,
        })
        .from(schema.changeEvents)
        .where(eq(schema.changeEvents.kind, 'container_status'))
        .orderBy(asc(schema.changeEvents.occurredAt)),
    ).toEqual([
      { currentValue: 'running', severity: 'info' },
      { currentValue: 'exited', severity: 'critical' },
      { currentValue: 'running', severity: 'info' },
    ]);
  });

  it('does nothing for a resource missing from the current container list', async () => {
    const resourceId = await insertResource();
    const dependencies = collectorFactory(() => []);

    await createDockerHealthHandler(
      db,
      'http://socket-proxy:2375',
      dependencies,
    )(job());

    expect(await db.select().from(schema.changeEvents)).toEqual([]);
    expect(await db.select().from(schema.resources)).toMatchObject([
      {
        id: resourceId,
        deletedAt: null,
        status: 'running',
        metadata: { preserved: true },
      },
    ]);
  });

  it('never calls resource update or delete paths', async () => {
    await insertResource();
    const update = vi.fn(() => {
      throw new Error('resources must stay read-only');
    });
    const remove = vi.fn(() => {
      throw new Error('resources must stay read-only');
    });
    const readOnlyDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property === 'update') return update;
        if (property === 'delete') return remove;
        return Reflect.get(target, property, receiver);
      },
    });
    const dependencies = collectorFactory(
      () => [status(containerId, 'running')],
    );

    await createDockerHealthHandler(
      readOnlyDb,
      'http://socket-proxy:2375',
      dependencies,
    )(job());

    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it('records an unlinked container with only its resource id', async () => {
    const resourceId = await insertResource();
    const dependencies = collectorFactory(
      () => [status(containerId, 'paused')],
    );

    await createDockerHealthHandler(
      db,
      'http://socket-proxy:2375',
      dependencies,
    )(job());

    expect(await db.select().from(schema.changeEvents)).toMatchObject([
      {
        projectId: null,
        componentId: null,
        resourceId,
        kind: 'container_status',
        severity: 'warning',
        currentValue: 'paused',
      },
    ]);
  });

  it('records an active linked container with project and component ids', async () => {
    const resourceId = await insertResource();
    const link = await linkResource(resourceId, 'active-project');
    const dependencies = collectorFactory(
      () => [status(containerId, 'restarting')],
    );

    await createDockerHealthHandler(
      db,
      'http://socket-proxy:2375',
      dependencies,
    )(job());

    expect(await db.select().from(schema.changeEvents)).toMatchObject([
      {
        projectId: link.projectId,
        componentId: link.componentId,
        resourceId,
        kind: 'container_status',
        severity: 'warning',
        currentValue: 'restarting',
      },
    ]);
  });

  it('treats a suggested component link as unlinked attribution', async () => {
    const resourceId = await insertResource();
    await linkResource(
      resourceId,
      'suggested-project',
      null,
      { linkedBy: 'suggested' },
    );
    const dependencies = collectorFactory(
      () => [status(containerId, 'paused')],
    );

    await createDockerHealthHandler(
      db,
      'http://socket-proxy:2375',
      dependencies,
    )(job());

    expect(await db.select().from(schema.changeEvents)).toMatchObject([
      {
        projectId: null,
        componentId: null,
        resourceId,
        kind: 'container_status',
      },
    ]);
  });

  it('uses an active confirmed link after an archived primary link', async () => {
    const resourceId = await insertResource();
    await linkResource(
      resourceId,
      'archived-primary',
      new Date(),
      { isPrimary: true },
    );
    const activeLink = await linkResource(
      resourceId,
      'active-secondary',
      null,
      { isPrimary: false },
    );
    const dependencies = collectorFactory(
      () => [status(containerId, 'running')],
    );

    await createDockerHealthHandler(
      db,
      'http://socket-proxy:2375',
      dependencies,
    )(job());

    expect(await db.select().from(schema.changeEvents)).toMatchObject([
      {
        projectId: activeLink.projectId,
        componentId: activeLink.componentId,
        resourceId,
        kind: 'container_status',
      },
    ]);
  });

  it('skips a container linked to an archived project', async () => {
    const resourceId = await insertResource();
    await linkResource(resourceId, 'archived-project', new Date());
    const dependencies = collectorFactory(
      () => [status(containerId, 'dead')],
    );

    await createDockerHealthHandler(
      db,
      'http://socket-proxy:2375',
      dependencies,
    )(job());

    expect(await db.select().from(schema.changeEvents)).toEqual([]);
  });

  it('does not record an event when health changes to null', async () => {
    await insertResource();
    let dockerStatus = 'Up 1 minute (healthy)';
    const dependencies = collectorFactory(
      () => [status(containerId, 'running', dockerStatus)],
    );
    const handler = createDockerHealthHandler(
      db,
      'http://socket-proxy:2375',
      dependencies,
    );

    await handler(job());
    dockerStatus = 'Up 2 minutes';
    await handler(job());

    expect(
      await db
        .select({
          currentValue: schema.changeEvents.currentValue,
        })
        .from(schema.changeEvents)
        .where(eq(schema.changeEvents.kind, 'container_health')),
    ).toEqual([{ currentValue: 'healthy' }]);
  });

  it('maps known and unknown states and health markers to safe severities', async () => {
    const cases = [
      ['running', 'running', 'Up (healthy)'],
      ['exited', 'exited', 'Up (unhealthy)'],
      ['dead', 'dead', 'Up (health: starting)'],
      ['restarting', 'restarting', 'Up'],
      ['created', 'created', 'Created'],
      ['removing', 'removing', 'Removal In Progress'],
    ] as const;
    for (const [externalId] of cases) {
      await insertResource(externalId);
    }
    const dependencies = collectorFactory(
      () => cases.map(([externalId, stateValue, dockerStatus]) => (
        status(externalId, stateValue, dockerStatus)
      )),
    );

    await createDockerHealthHandler(
      db,
      'http://socket-proxy:2375',
      dependencies,
    )(job());

    const events = await db
      .select({
        kind: schema.changeEvents.kind,
        currentValue: schema.changeEvents.currentValue,
        severity: schema.changeEvents.severity,
      })
      .from(schema.changeEvents);
    expect(events).toEqual(expect.arrayContaining([
      { kind: 'container_status', currentValue: 'running', severity: 'info' },
      { kind: 'container_status', currentValue: 'exited', severity: 'critical' },
      { kind: 'container_status', currentValue: 'dead', severity: 'critical' },
      { kind: 'container_status', currentValue: 'restarting', severity: 'warning' },
      { kind: 'container_status', currentValue: 'created', severity: 'warning' },
      { kind: 'container_status', currentValue: 'removing', severity: 'warning' },
      { kind: 'container_health', currentValue: 'healthy', severity: 'info' },
      { kind: 'container_health', currentValue: 'unhealthy', severity: 'critical' },
      { kind: 'container_health', currentValue: 'starting', severity: 'info' },
    ]));
    expect(events).toHaveLength(9);
  });

  it('reads only active Docker resources and enqueues one unique job', async () => {
    await insertResource(containerId);
    await insertResource('b'.repeat(64), { provider: 'vercel' });
    await insertResource('c'.repeat(64), { deletedAt: new Date() });
    const dependencies = collectorFactory(() => [
      status(containerId, 'running'),
      status('b'.repeat(64), 'dead'),
      status('c'.repeat(64), 'dead'),
    ]);

    await createDockerHealthHandler(
      db,
      'http://socket-proxy:2375',
      dependencies,
    )(job());
    await enqueueDockerHealthJob(db, 'http://socket-proxy:2375');
    await enqueueDockerHealthJob(db, 'http://socket-proxy:2375');

    expect(await db.select().from(schema.changeEvents)).toHaveLength(1);
    expect(await db.select().from(schema.jobs)).toMatchObject([
      {
        type: 'docker.health',
        payload: {},
        status: 'pending',
      },
    ]);
  });
});
