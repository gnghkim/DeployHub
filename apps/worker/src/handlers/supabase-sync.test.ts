import { randomBytes, randomUUID } from 'node:crypto';
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
  ExternalResource,
  SupabaseCollector,
} from '@deployhub/collectors';
import { encrypt } from '@deployhub/shared';
import {
  createSupabaseSyncHandler,
  enqueueSupabaseSyncJobs,
} from './supabase-sync';

const encryptionKey = randomBytes(32);
const token = 'supabase-worker-collector-secret';
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
  await db.delete(schema.providerAccounts);
  await db.delete(schema.jobs);
});

async function insertAccount(lastError?: string): Promise<string> {
  const [account] = await db
    .insert(schema.providerAccounts)
    .values({
      provider: 'supabase',
      name: 'supabase',
      encryptedToken: encrypt(token, encryptionKey),
      lastError,
    })
    .returning({ id: schema.providerAccounts.id });
  return account!.id;
}

function job(accountId: string): JobRecord {
  return {
    id: 'supabase-job-id',
    type: 'supabase.sync',
    payload: { accountId },
    attempts: 1,
    maxAttempts: 3,
  };
}

function collector(resources: ExternalResource[]): SupabaseCollector {
  return {
    provider: 'supabase',
    testConnection: vi.fn(),
    listResources: vi.fn().mockResolvedValue(resources),
  };
}

function supabaseResource(
  externalId = 'abcdefghijklmnopqrst',
): ExternalResource {
  return {
    provider: 'supabase',
    externalId,
    resourceType: 'supabase_project',
    name: 'LinkVault',
    status: 'ACTIVE_HEALTHY',
    region: 'ap-northeast-2',
    metadata: { organizationId: 'org_123' },
    observedAt: '2026-08-04T00:00:00.000Z',
  };
}

async function insertProjectWithSupabaseComponents(): Promise<{
  projectId: string;
  componentIds: string[];
}> {
  const [project] = await db.insert(schema.projects).values({
    name: 'LinkVault',
    slug: 'linkvault',
    lifecycle: 'production',
  }).returning({ id: schema.projects.id });
  const componentRows = await db.insert(schema.components).values([
    {
      projectId: project!.id,
      name: 'database',
      slug: 'database',
      componentType: 'database',
      provider: 'supabase',
      externalRef: 'abcdefghijklmnopqrst',
    },
    {
      projectId: project!.id,
      name: 'authentication',
      slug: 'authentication',
      componentType: 'authentication',
      provider: 'supabase',
      externalRef: 'abcdefghijklmnopqrst',
    },
  ]).returning({ id: schema.components.id });
  return {
    projectId: project!.id,
    componentIds: componentRows.map(({ id }) => id),
  };
}

describe('Supabase sync handler', () => {
  it('upserts a project, links every exact ref, and records success', async () => {
    const accountId = await insertAccount('old error');
    const declared = await insertProjectWithSupabaseComponents();
    const createCollector = vi.fn(() => collector([supabaseResource()]));

    await createSupabaseSyncHandler(db, encryptionKey, {
      createCollector,
    })(job(accountId));

    expect(createCollector).toHaveBeenCalledWith(token);
    const [resource] = await db.select().from(schema.resources);
    expect(resource).toMatchObject({
      provider: 'supabase',
      providerAccountId: accountId,
      externalId: 'abcdefghijklmnopqrst',
      resourceType: 'supabase_project',
      name: 'LinkVault',
      status: 'ACTIVE_HEALTHY',
      region: 'ap-northeast-2',
      metadata: { organizationId: 'org_123' },
      deletedAt: null,
    });
    const links = await db
      .select()
      .from(schema.componentResources)
      .orderBy(asc(schema.componentResources.componentId));
    expect(links).toHaveLength(2);
    expect(new Set(links.map(({ componentId }) => componentId))).toEqual(
      new Set(declared.componentIds),
    );
    expect(links.every(({ linkedBy }) => linkedBy === 'manifest')).toBe(true);
    const [account] = await db
      .select()
      .from(schema.providerAccounts)
      .where(eq(schema.providerAccounts.id, accountId));
    expect(account?.lastSyncAt).toBeInstanceOf(Date);
    expect(account?.lastError).toBeNull();
  });

  it('soft-deletes projects no longer returned by the account', async () => {
    const accountId = await insertAccount();
    await db.insert(schema.resources).values([
      {
        provider: 'supabase',
        providerAccountId: accountId,
        externalId: 'abcdefghijklmnopqrst',
        resourceType: 'supabase_project',
        name: 'Old LinkVault',
        metadata: {},
        deletedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        provider: 'supabase',
        providerAccountId: accountId,
        externalId: 'missing-project',
        resourceType: 'supabase_project',
        name: 'Missing',
        metadata: {},
      },
    ]);

    await createSupabaseSyncHandler(db, encryptionKey, {
      createCollector: () => collector([supabaseResource()]),
    })(job(accountId));

    const rows = await db
      .select()
      .from(schema.resources)
      .orderBy(asc(schema.resources.externalId));
    expect(rows[0]).toMatchObject({
      externalId: 'abcdefghijklmnopqrst',
      name: 'LinkVault',
      deletedAt: null,
    });
    expect(rows[1]?.externalId).toBe('missing-project');
    expect(rows[1]?.deletedAt).toBeInstanceOf(Date);
  });

  it('preserves observations and stores only a safe sync error', async () => {
    const accountId = await insertAccount();
    await db.insert(schema.resources).values({
      provider: 'supabase',
      providerAccountId: accountId,
      externalId: 'existing-project',
      resourceType: 'supabase_project',
      name: 'Existing',
      metadata: {},
    });
    const createCollector = vi.fn(() => ({
      ...collector([]),
      listResources: vi.fn().mockRejectedValue(
        new Error(`HTTP 401 ${token}`),
      ),
    }));

    await expect(
      createSupabaseSyncHandler(db, encryptionKey, {
        createCollector,
      })(job(accountId)),
    ).rejects.toThrow('Supabase 동기화에 실패했습니다. (HTTP 401)');

    expect(await db.select().from(schema.resources)).toHaveLength(1);
    const [account] = await db
      .select()
      .from(schema.providerAccounts)
      .where(eq(schema.providerAccounts.id, accountId));
    expect(account?.lastError).toBe(
      'Supabase 동기화에 실패했습니다. (HTTP 401)',
    );
    expect(account?.lastError).not.toContain(token);
  });

  it('rejects a missing or wrong-provider account', async () => {
    await expect(
      createSupabaseSyncHandler(db, encryptionKey)(job(randomUUID())),
    ).rejects.toThrow('Supabase 계정을 찾을 수 없습니다.');

    const [github] = await db.insert(schema.providerAccounts).values({
      provider: 'github',
      name: 'octocat',
      encryptedToken: encrypt(token, encryptionKey),
    }).returning({ id: schema.providerAccounts.id });
    await expect(
      createSupabaseSyncHandler(db, encryptionKey)(job(github!.id)),
    ).rejects.toThrow('Supabase 계정을 찾을 수 없습니다.');
  });

  it('deduplicates active jobs per Supabase account', async () => {
    const accountId = await insertAccount();

    await enqueueSupabaseSyncJobs(db);
    await enqueueSupabaseSyncJobs(db);

    const queued = await db.select().from(schema.jobs);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      type: 'supabase.sync',
      dedupeKey: `supabase:${accountId}`,
      payload: { accountId },
      status: 'pending',
    });
  });
});
