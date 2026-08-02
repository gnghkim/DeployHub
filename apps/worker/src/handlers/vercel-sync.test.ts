import { randomBytes } from 'node:crypto';
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
  coalesceSnapshotCaptureJob,
  schema,
  type Db,
  type JobRecord,
} from '@deployhub/db';
import type {
  ExternalDeployment,
  ExternalResource,
  VercelCollector,
} from '@deployhub/collectors';
import { encrypt } from '@deployhub/shared';
import {
  createVercelSyncHandler,
  enqueueVercelSyncJobs,
} from './vercel-sync';

const encryptionKey = randomBytes(32);
const token = 'vercel_worker_collector_secret';
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
  await db.delete(schema.componentResources);
  await db.delete(schema.components);
  await db.delete(schema.resources);
  await db.delete(schema.projects);
  await db.delete(schema.providerAccounts);
  await db.delete(schema.jobs);
});

async function insertAccount(
  lastError?: string,
  externalAccountId?: string,
): Promise<string> {
  const [account] = await db
    .insert(schema.providerAccounts)
    .values({
      provider: 'vercel',
      name: 'deployhub-team',
      externalAccountId,
      encryptedToken: encrypt(token, encryptionKey),
      lastError,
    })
    .returning({ id: schema.providerAccounts.id });
  return account!.id;
}

function job(accountId: string): JobRecord {
  return {
    id: 'vercel-job-id',
    type: 'vercel.sync',
    payload: { accountId },
    attempts: 1,
    maxAttempts: 3,
  };
}

function collector(
  resources: ExternalResource[],
  deployments: ExternalDeployment[],
): VercelCollector {
  return {
    provider: 'vercel',
    testConnection: vi.fn(),
    listResources: vi.fn().mockResolvedValue(resources),
    listDeployments: vi.fn().mockResolvedValue(deployments),
  };
}

async function seedVercelSnapshotProject(input: {
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
    provider: 'vercel',
    externalRef: input.externalId,
  });
  return project!;
}

function vercelResource(externalId: string): ExternalResource {
  return {
    provider: 'vercel',
    externalId,
    resourceType: 'vercel_project',
    name: externalId,
    metadata: {},
    observedAt: '2026-08-02T00:00:00.000Z',
  };
}

function vercelDeployment(input: {
  externalId: string;
  deploymentId?: string;
  environment?: string;
  status?: string;
}): ExternalDeployment {
  return {
    resourceExternalId: input.externalId,
    externalDeploymentId: input.deploymentId ?? `dpl-${input.externalId}`,
    environment: input.environment ?? 'production',
    status: input.status ?? 'READY',
    metadata: {},
  };
}

describe('Vercel sync handler', () => {
  it('enqueues a capture for a newly observed READY production deployment', async () => {
    const accountId = await insertAccount();
    const project = await seedVercelSnapshotProject({
      slug: 'vercel-automatic',
      externalId: 'vercel-automatic',
    });

    await createVercelSyncHandler(db, encryptionKey, {
      createCollector: () => collector(
        [vercelResource('vercel-automatic')],
        [vercelDeployment({
          externalId: 'vercel-automatic',
          environment: 'PRODUCTION',
        })],
      ),
    })(job(accountId));

    const queued = await db.select().from(schema.jobs);
    const [deployment] = await db.select().from(schema.deployments);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      type: 'snapshot.capture',
      dedupeKey: `snapshot:${project.id}`,
      payload: {
        projectId: project.id,
        url: 'https://vercel-automatic.example.com',
        deploymentId: deployment!.id,
      },
      status: 'pending',
    });
  });

  it('does not enqueue for an existing deployment status update', async () => {
    const accountId = await insertAccount();
    const project = await seedVercelSnapshotProject({
      slug: 'vercel-existing',
      externalId: 'vercel-existing',
    });
    await db.insert(schema.deployments).values({
      projectId: project.id,
      provider: 'vercel',
      externalDeploymentId: 'dpl-vercel-existing',
      environment: 'production',
      status: 'BUILDING',
    });

    await createVercelSyncHandler(db, encryptionKey, {
      createCollector: () => collector(
        [vercelResource('vercel-existing')],
        [vercelDeployment({ externalId: 'vercel-existing' })],
      ),
    })(job(accountId));

    expect(await db.select().from(schema.jobs)).toEqual([]);
  });

  it('rolls back all deployments when the second capture enqueue fails', async () => {
    const accountId = await insertAccount();
    const project = await seedVercelSnapshotProject({
      slug: 'vercel-atomic',
      externalId: 'vercel-atomic',
    });
    const deployments = [
      vercelDeployment({
        externalId: 'vercel-atomic',
        deploymentId: 'dpl-vercel-first',
      }),
      vercelDeployment({
        externalId: 'vercel-atomic',
        deploymentId: 'dpl-vercel-second',
      }),
    ];
    const createCollector = () => collector(
      [vercelResource('vercel-atomic')],
      deployments,
    );
    let enqueueCalls = 0;

    await expect(createVercelSyncHandler(db, encryptionKey, {
      createCollector,
      enqueueCapture: async (executor, payload) => {
        enqueueCalls += 1;
        if (enqueueCalls === 2) {
          throw new Error('injected second queue failure');
        }
        return coalesceSnapshotCaptureJob(executor, {
          projectId: payload.projectId,
          payload: { ...payload },
          maxAttempts: 3,
        });
      },
    })(job(accountId))).rejects.toThrow();

    expect(await db.select().from(schema.deployments)).toEqual([]);
    expect(await db.select().from(schema.jobs)).toEqual([]);

    await createVercelSyncHandler(db, encryptionKey, {
      createCollector,
    })(job(accountId));

    const deploymentRows = await db.select().from(schema.deployments);
    const queued = await db.select().from(schema.jobs);
    const latestDeployment = deploymentRows.find(
      (deployment) => deployment.externalDeploymentId === 'dpl-vercel-second',
    );
    expect(deploymentRows).toHaveLength(2);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      dedupeKey: `snapshot:${project.id}`,
      payload: {
        projectId: project.id,
        url: 'https://vercel-atomic.example.com',
        deploymentId: latestDeployment!.id,
      },
    });
  });

  it('ignores preview, non-ready, manual, disabled, and missing URL deployments', async () => {
    const accountId = await insertAccount();
    const cases: Array<{
      slug: string;
      environment?: string;
      status?: string;
      snapshotMode?: 'automatic' | 'manual' | 'disabled';
      snapshotUrl?: string | null;
    }> = [
      { slug: 'vercel-preview', environment: 'preview' },
      { slug: 'vercel-building', status: 'BUILDING' },
      { slug: 'vercel-manual', snapshotMode: 'manual' },
      { slug: 'vercel-disabled', snapshotMode: 'disabled' },
      { slug: 'vercel-no-url', snapshotUrl: null },
    ];
    for (const input of cases) {
      await seedVercelSnapshotProject({
        slug: input.slug,
        externalId: input.slug,
        snapshotMode: input.snapshotMode,
        snapshotUrl: input.snapshotUrl,
      });
    }

    await createVercelSyncHandler(db, encryptionKey, {
      createCollector: () => collector(
        cases.map((input) => vercelResource(input.slug)),
        cases.map((input) => vercelDeployment({
          externalId: input.slug,
          environment: input.environment,
          status: input.status,
        })),
      ),
    })(job(accountId));

    expect(await db.select().from(schema.jobs)).toEqual([]);
  });

  it('passes the stored external account ID to the collector', async () => {
    const accountId = await insertAccount(undefined, 'team_123');
    const createCollector = vi.fn(() => collector([], []));

    await createVercelSyncHandler(db, encryptionKey, {
      createCollector,
    })(job(accountId));

    expect(createCollector).toHaveBeenCalledWith(token, 'team_123');
  });

  it('links a Vercel project only on an exact declared externalRef', async () => {
    const accountId = await insertAccount();
    const [project] = await db.insert(schema.projects).values({
      name: 'DeployHub',
      slug: 'deployhub',
    }).returning();
    await db.insert(schema.components).values({
      projectId: project!.id,
      name: 'web',
      slug: 'web',
      componentType: 'frontend',
      provider: 'vercel',
      externalRef: 'prj_current',
    });
    const resources: ExternalResource[] = [
      {
        provider: 'vercel',
        externalId: 'prj_current',
        resourceType: 'vercel_project',
        name: 'deployhub',
        metadata: {},
        observedAt: '2026-07-27T00:00:00.000Z',
      },
      {
        provider: 'vercel',
        externalId: 'prj_current_old',
        resourceType: 'vercel_project',
        name: 'deployhub-old',
        metadata: {},
        observedAt: '2026-07-27T00:00:00.000Z',
      },
    ];

    await createVercelSyncHandler(db, encryptionKey, {
      createCollector: () => collector(resources, []),
    })(job(accountId));

    const links = await db
      .select({
        externalId: schema.resources.externalId,
        linkedBy: schema.componentResources.linkedBy,
      })
      .from(schema.componentResources)
      .innerJoin(
        schema.resources,
        eq(schema.resources.id, schema.componentResources.resourceId),
      );
    expect(links).toEqual([
      {
        externalId: 'prj_current',
        linkedBy: 'manifest',
      },
    ]);
  });

  it('upserts resources and deployments while soft-deleting missing resources', async () => {
    const accountId = await insertAccount('이전 동기화 오류');
    const [project] = await db.insert(schema.projects).values({
      name: 'DeployHub',
      slug: 'deployhub',
    }).returning();
    const [component] = await db.insert(schema.components).values({
      projectId: project!.id,
      name: 'Web',
      slug: 'web',
      componentType: 'frontend',
      provider: 'vercel',
      externalRef: 'prj_current',
    }).returning();
    const [current] = await db.insert(schema.resources).values({
      provider: 'vercel',
      providerAccountId: accountId,
      externalId: 'prj_current',
      resourceType: 'vercel_project',
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
    await db.insert(schema.resources).values({
      provider: 'vercel',
      providerAccountId: accountId,
      externalId: 'prj_missing',
      resourceType: 'vercel_project',
      name: 'missing',
      metadata: {},
    });
    await db.insert(schema.deployments).values({
      provider: 'vercel',
      externalDeploymentId: 'dpl_current',
      environment: 'production',
      status: 'BUILDING',
    });

    const resources: ExternalResource[] = [{
      provider: 'vercel',
      externalId: 'prj_current',
      resourceType: 'vercel_project',
      name: 'current',
      status: 'active',
      url: 'https://deployhub.example.com',
      metadata: { framework: 'nextjs' },
      observedAt: '2026-07-24T22:00:00.000Z',
    }];
    const deployments: ExternalDeployment[] = [{
      resourceExternalId: 'prj_current',
      externalDeploymentId: 'dpl_current',
      environment: 'production',
      status: 'READY',
      commitSha: 'a41d82c',
      deploymentUrl: 'https://deployhub.example.com',
      startedAt: '2026-07-24T22:02:00.000Z',
      completedAt: '2026-07-24T22:03:00.000Z',
      metadata: {},
    }];
    const createCollector = vi.fn(() =>
      collector(resources, deployments)
    );

    await createVercelSyncHandler(db, encryptionKey, {
      createCollector,
    })(job(accountId));

    expect(createCollector).toHaveBeenCalledWith(token, undefined);
    const resourceRows = await db
      .select()
      .from(schema.resources)
      .orderBy(asc(schema.resources.externalId));
    expect(resourceRows).toHaveLength(2);
    expect(resourceRows[0]).toMatchObject({
      externalId: 'prj_current',
      name: 'current',
      deletedAt: null,
    });
    expect(resourceRows[1]?.externalId).toBe('prj_missing');
    expect(resourceRows[1]?.deletedAt).toBeInstanceOf(Date);

    const deploymentRows = await db.select().from(schema.deployments);
    expect(deploymentRows).toHaveLength(1);
    expect(deploymentRows[0]).toMatchObject({
      projectId: project!.id,
      componentId: component!.id,
      provider: 'vercel',
      externalDeploymentId: 'dpl_current',
      status: 'READY',
      commitSha: 'a41d82c',
      startedAt: new Date('2026-07-24T22:02:00.000Z'),
      completedAt: new Date('2026-07-24T22:03:00.000Z'),
    });

    const [account] = await db
      .select()
      .from(schema.providerAccounts)
      .where(eq(schema.providerAccounts.id, accountId));
    expect(account?.lastSyncAt).toBeInstanceOf(Date);
    expect(account?.lastError).toBeNull();
  });

  it('records a safe diagnostic when no projects are visible', async () => {
    const accountId = await insertAccount();
    const createCollector = vi.fn(() => collector([], []));

    await createVercelSyncHandler(db, encryptionKey, {
      createCollector,
    })(job(accountId));

    const [account] = await db
      .select()
      .from(schema.providerAccounts)
      .where(eq(schema.providerAccounts.id, accountId));
    expect(account?.lastSyncAt).toBeInstanceOf(Date);
    expect(account?.lastError).toBe(
      '프로젝트 0건. 팀 계정이면 teamId와 토큰 권한을 확인해 주세요.',
    );
    expect(account?.lastError).not.toContain(token);
  });

  it('stores only a short HTTP status error without token or response details', async () => {
    const accountId = await insertAccount();
    const createCollector = vi.fn(() => ({
      ...collector([], []),
      listResources: vi.fn().mockRejectedValue(
        new Error(
          `Vercel API 요청에 실패했습니다. (HTTP 503): ${token}`,
        ),
      ),
    }));

    await expect(
      createVercelSyncHandler(db, encryptionKey, {
        createCollector,
      })(job(accountId)),
    ).rejects.toThrow('Vercel 동기화에 실패했습니다. (HTTP 503)');

    const [account] = await db
      .select()
      .from(schema.providerAccounts)
      .where(eq(schema.providerAccounts.id, accountId));
    expect(account?.lastError).toBe(
      'Vercel 동기화에 실패했습니다. (HTTP 503)',
    );
    expect(account?.lastError).not.toContain(token);
    expect(account?.lastSyncAt).toBeNull();
  });

  it('enqueues an immediate sync job for each Vercel account', async () => {
    const accountId = await insertAccount();

    await enqueueVercelSyncJobs(db);

    const queued = await db.select().from(schema.jobs);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      type: 'vercel.sync',
      payload: { accountId },
      status: 'pending',
    });
  });
});
