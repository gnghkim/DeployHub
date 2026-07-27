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

async function insertAccount(lastError?: string): Promise<string> {
  const [account] = await db
    .insert(schema.providerAccounts)
    .values({
      provider: 'vercel',
      name: 'deployhub-team',
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

describe('Vercel sync handler', () => {
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

    expect(createCollector).toHaveBeenCalledWith(token);
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
      '프로젝트 0건. 팀 계정 토큰이면 teamId 지정이 필요한데 아직 지원하지 않습니다.',
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
