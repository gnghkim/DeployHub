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
  listProjectStatusData,
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
  await db.delete(schema.changeEvents);
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
    listContainerStatuses: vi.fn().mockResolvedValue([]),
    listResources: vi.fn().mockResolvedValue(resources),
    listDeployments: vi.fn().mockResolvedValue(deployments),
    listSnapshots: vi.fn().mockResolvedValue(snapshots),
  };
}

async function runEmptySync() {
  await createDockerSyncHandler(
    db,
    'http://socket-proxy:2375',
    { createCollector: () => collector([], [], []) },
  )(job());
}

async function seedDockerSnapshotProject(input: {
  slug: string;
  externalId: string;
  snapshotMode?: 'automatic' | 'manual' | 'disabled';
  snapshotUrl?: string | null;
}) {
  const [project] = await db.insert(schema.projects).values({
    name: input.slug,
    slug: input.slug,
    snapshotMode: input.snapshotMode ?? 'automatic',
    snapshotUrl: input.snapshotUrl === undefined
      ? `https://${input.slug}.example.com`
      : input.snapshotUrl,
  }).returning();
  await db.insert(schema.components).values({
    projectId: project!.id,
    name: `${input.slug}-web`,
    slug: `${input.slug}-web`,
    componentType: 'frontend',
    provider: 'docker',
    containerName: input.externalId,
  });
  return project!;
}

function dockerResource(externalId: string): ExternalResource {
  return {
    provider: 'docker',
    externalId,
    resourceType: 'docker_container',
    name: externalId,
    metadata: {},
    observedAt: '2026-08-02T00:00:00.000Z',
  };
}

function dockerDeployment(input: {
  externalId: string;
  deploymentId?: string;
  environment?: string;
  status?: string;
}): ExternalDeployment {
  return {
    resourceExternalId: input.externalId,
    externalDeploymentId: input.deploymentId ?? `dpl-${input.externalId}`,
    environment: input.environment ?? 'production',
    status: input.status ?? 'running',
    metadata: {},
  };
}

describe('Docker sync handler', () => {
  it('enqueues a capture for a newly observed running production deployment', async () => {
    const project = await seedDockerSnapshotProject({
      slug: 'docker-automatic',
      externalId: 'docker-automatic',
    });

    await createDockerSyncHandler(db, 'http://socket-proxy:2375', {
      createCollector: () => collector(
        [dockerResource('docker-automatic')],
        [dockerDeployment({ externalId: 'docker-automatic' })],
        [],
      ),
    })(job());

    const queued = await db.select().from(schema.jobs);
    const [deployment] = await db.select().from(schema.deployments);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      type: 'snapshot.capture',
      dedupeKey: `snapshot:${project.id}`,
      payload: {
        projectId: project.id,
        url: 'https://docker-automatic.example.com',
        deploymentId: deployment!.id,
      },
      status: 'pending',
    });
  });

  it('rolls back a new deployment when capture enqueue fails and retries cleanly', async () => {
    await seedDockerSnapshotProject({
      slug: 'docker-enqueue-retry',
      externalId: 'docker-enqueue-retry',
    });
    const createCollector = () => collector(
      [dockerResource('docker-enqueue-retry')],
      [dockerDeployment({ externalId: 'docker-enqueue-retry' })],
      [],
    );

    await expect(createDockerSyncHandler(
      db,
      'http://socket-proxy:2375',
      {
        createCollector,
        enqueueCapture: async () => {
          throw new Error('injected queue failure');
        },
      },
    )(job())).rejects.toThrow();

    expect(await db.select().from(schema.deployments)).toEqual([]);
    expect(await db.select().from(schema.jobs)).toEqual([]);

    await createDockerSyncHandler(db, 'http://socket-proxy:2375', {
      createCollector,
    })(job());

    expect(await db.select().from(schema.deployments)).toHaveLength(1);
    expect(await db.select().from(schema.jobs)).toHaveLength(1);
  });

  it('does not enqueue for an existing deployment status update', async () => {
    const project = await seedDockerSnapshotProject({
      slug: 'docker-existing',
      externalId: 'docker-existing',
    });
    await db.insert(schema.deployments).values({
      projectId: project.id,
      provider: 'docker',
      externalDeploymentId: 'dpl-docker-existing',
      environment: 'production',
      status: 'starting',
    });

    await createDockerSyncHandler(db, 'http://socket-proxy:2375', {
      createCollector: () => collector(
        [dockerResource('docker-existing')],
        [dockerDeployment({ externalId: 'docker-existing' })],
        [],
      ),
    })(job());

    expect(await db.select().from(schema.jobs)).toEqual([]);
  });

  it('ignores ineligible deployments and projects', async () => {
    const cases: Array<{
      slug: string;
      environment?: string;
      status?: string;
      snapshotMode?: 'automatic' | 'manual' | 'disabled';
      snapshotUrl?: string | null;
    }> = [
      { slug: 'docker-preview', environment: 'preview' },
      { slug: 'docker-staging', environment: 'staging' },
      { slug: 'docker-stopped', status: 'stopped' },
      { slug: 'docker-failed', status: 'failed' },
      { slug: 'docker-manual', snapshotMode: 'manual' as const },
      { slug: 'docker-disabled', snapshotMode: 'disabled' as const },
      { slug: 'docker-no-url', snapshotUrl: null },
    ];
    for (const input of cases) {
      await seedDockerSnapshotProject({
        slug: input.slug,
        externalId: input.slug,
        snapshotMode: input.snapshotMode,
        snapshotUrl: input.snapshotUrl,
      });
    }

    await createDockerSyncHandler(db, 'http://socket-proxy:2375', {
      createCollector: () => collector(
        cases.map((input) => dockerResource(input.slug)),
        cases.map((input) => dockerDeployment({
          externalId: input.slug,
          environment: input.environment,
          status: input.status,
        })),
        [],
      ),
    })(job());

    expect(await db.select().from(schema.jobs)).toEqual([]);
  });

  it('coalesces two new deployments for one project into one active job', async () => {
    const project = await seedDockerSnapshotProject({
      slug: 'docker-coalesced',
      externalId: 'docker-coalesced',
    });

    await createDockerSyncHandler(db, 'http://socket-proxy:2375', {
      createCollector: () => collector(
        [dockerResource('docker-coalesced')],
        [
          dockerDeployment({
            externalId: 'docker-coalesced',
            deploymentId: 'dpl-docker-first',
          }),
          dockerDeployment({
            externalId: 'docker-coalesced',
            deploymentId: 'dpl-docker-second',
          }),
        ],
        [],
      ),
    })(job());

    const queued = await db.select().from(schema.jobs);
    const deploymentRows = await db.select().from(schema.deployments);
    const latestDeployment = deploymentRows.find(
      (deployment) => deployment.externalDeploymentId === 'dpl-docker-second',
    );
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      type: 'snapshot.capture',
      dedupeKey: `snapshot:${project.id}`,
      payload: {
        projectId: project.id,
        url: 'https://docker-coalesced.example.com',
        deploymentId: latestDeployment!.id,
      },
      status: 'pending',
    });
  });

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

  it('deletes an event older than 90 days when a newer event has the same scope and kind', async () => {
    const [project] = await db.insert(schema.projects).values({
      name: 'Retention',
      slug: 'retention-replaced',
    }).returning();
    if (!project) throw new Error('project insert failed');
    await db.insert(schema.changeEvents).values([
      {
        projectId: project.id,
        kind: 'container_status',
        severity: 'critical',
        previousValue: null,
        currentValue: 'exited',
        detail: 'old status',
        occurredAt: sql`now() - interval '91 days'`,
      },
      {
        projectId: project.id,
        kind: 'container_status',
        severity: 'info',
        previousValue: 'exited',
        currentValue: 'running',
        detail: 'new status',
        occurredAt: sql`now() - interval '1 day'`,
      },
    ]);

    await runEmptySync();

    const events = await db.select().from(schema.changeEvents);
    expect(events).toHaveLength(1);
    expect(events[0]?.currentValue).toBe('running');
  });

  it('retains an event older than 90 days when it is latest for its scope and kind', async () => {
    await db.insert(schema.changeEvents).values({
      projectId: null,
      componentId: null,
      resourceId: null,
      kind: 'sync_failure',
      severity: 'critical',
      previousValue: null,
      currentValue: 'failed',
      detail: 'old but latest global failure',
      occurredAt: sql`now() - interval '91 days'`,
    });

    await runEmptySync();

    const events = await db.select().from(schema.changeEvents);
    expect(events).toHaveLength(1);
    expect(events[0]?.currentValue).toBe('failed');
  });

  it('retains every event that is 90 days old or newer', async () => {
    const [project] = await db.insert(schema.projects).values({
      name: 'Recent retention',
      slug: 'retention-recent',
    }).returning();
    if (!project) throw new Error('project insert failed');
    await db.insert(schema.changeEvents).values([
      {
        projectId: project.id,
        kind: 'container_health',
        severity: 'warning',
        previousValue: null,
        currentValue: 'unhealthy',
        detail: 'recent old value',
        occurredAt: sql`now() - interval '89 days'`,
      },
      {
        projectId: project.id,
        kind: 'container_health',
        severity: 'info',
        previousValue: 'unhealthy',
        currentValue: 'healthy',
        detail: 'recent new value',
        occurredAt: sql`now() - interval '1 day'`,
      },
    ]);

    await runEmptySync();

    const events = await db
      .select()
      .from(schema.changeEvents)
      .orderBy(asc(schema.changeEvents.seq));
    expect(events.map((event) => event.currentValue)).toEqual([
      'unhealthy',
      'healthy',
    ]);
  });

  it('does not treat a newer seq from another scope or kind as a replacement', async () => {
    const [scopeA, scopeB, kindScope] = await db
      .insert(schema.projects)
      .values([
        { name: 'Scope A', slug: 'retention-scope-a' },
        { name: 'Scope B', slug: 'retention-scope-b' },
        { name: 'Kind scope', slug: 'retention-kind-scope' },
      ])
      .returning();
    if (!scopeA || !scopeB || !kindScope) {
      throw new Error('project insert failed');
    }
    await db.insert(schema.changeEvents).values([
      {
        projectId: scopeA.id,
        kind: 'container_status',
        severity: 'critical',
        currentValue: 'scope-a-old',
        detail: 'must survive a newer event in another scope',
        occurredAt: sql`now() - interval '91 days'`,
      },
      {
        projectId: kindScope.id,
        kind: 'container_health',
        severity: 'critical',
        currentValue: 'health-old',
        detail: 'must survive a newer event of another kind',
        occurredAt: sql`now() - interval '91 days'`,
      },
      {
        projectId: scopeB.id,
        kind: 'container_status',
        severity: 'info',
        currentValue: 'scope-b-new',
        detail: 'newer seq but another scope',
        occurredAt: sql`now() - interval '1 day'`,
      },
      {
        projectId: kindScope.id,
        kind: 'container_status',
        severity: 'info',
        currentValue: 'status-new',
        detail: 'newer seq but another kind',
        occurredAt: sql`now() - interval '1 day'`,
      },
    ]);

    await runEmptySync();

    const events = await db.select().from(schema.changeEvents);
    expect(events.map((event) => event.currentValue)).toEqual(
      expect.arrayContaining([
        'scope-a-old',
        'health-old',
        'scope-b-new',
        'status-new',
      ]),
    );
    expect(events).toHaveLength(4);
  });

  it('uses seq rather than occurredAt to decide which event is newer', async () => {
    const [seqScope, timestampScope] = await db
      .insert(schema.projects)
      .values([
        { name: 'Sequence scope', slug: 'retention-sequence' },
        { name: 'Timestamp scope', slug: 'retention-timestamp' },
      ])
      .returning();
    if (!seqScope || !timestampScope) {
      throw new Error('project insert failed');
    }
    await db.insert(schema.changeEvents).values([
      {
        projectId: seqScope.id,
        kind: 'container_status',
        severity: 'critical',
        currentValue: 'lower-seq-old',
        detail: 'deleted by a larger seq with an older timestamp',
        occurredAt: sql`now() - interval '91 days'`,
      },
      {
        projectId: seqScope.id,
        kind: 'container_status',
        severity: 'critical',
        currentValue: 'higher-seq-older-time',
        detail: 'latest by seq',
        occurredAt: sql`now() - interval '120 days'`,
      },
      {
        projectId: timestampScope.id,
        kind: 'container_health',
        severity: 'info',
        currentValue: 'lower-seq-newer-time',
        detail: 'newer timestamp but lower seq',
        occurredAt: sql`now() - interval '1 day'`,
      },
      {
        projectId: timestampScope.id,
        kind: 'container_health',
        severity: 'critical',
        currentValue: 'higher-seq-old',
        detail: 'old timestamp but latest by seq',
        occurredAt: sql`now() - interval '91 days'`,
      },
    ]);

    await runEmptySync();

    const events = await db
      .select()
      .from(schema.changeEvents)
      .orderBy(asc(schema.changeEvents.seq));
    expect(events.map((event) => event.currentValue)).toEqual([
      'higher-seq-older-time',
      'lower-seq-newer-time',
      'higher-seq-old',
    ]);
  });

  it('does not change status judgement when cleanup preserves an old latest critical event', async () => {
    const [project] = await db.insert(schema.projects).values({
      name: 'Dead target',
      slug: 'dead-target',
    }).returning();
    if (!project) throw new Error('project insert failed');
    await db.insert(schema.changeEvents).values({
      projectId: project.id,
      componentId: null,
      resourceId: null,
      kind: 'container_status',
      severity: 'critical',
      previousValue: 'running',
      currentValue: 'dead',
      detail: 'target is still dead',
      occurredAt: sql`now() - interval '91 days'`,
    });

    const before = (await listProjectStatusData(
      db,
      [project.id],
    )).get(project.id);
    await runEmptySync();
    const after = (await listProjectStatusData(
      db,
      [project.id],
    )).get(project.id);

    expect(before?.status).toBe('장애');
    expect(after?.status).toBe(before?.status);
    expect(after?.latestEvents).toMatchObject([
      {
        currentValue: 'dead',
        severity: 'critical',
      },
    ]);
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
