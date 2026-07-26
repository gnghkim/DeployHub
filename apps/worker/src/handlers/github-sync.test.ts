import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { startTestDb } from '@deployhub/db/test/helpers/pg.js';
import { schema, type Db, type JobRecord } from '@deployhub/db';
import type { ExternalResource, ProviderCollector } from '@deployhub/collectors';
import { encrypt } from '@deployhub/shared';
import {
  createGithubSyncHandler,
  enqueueGithubSyncJobs,
} from './github-sync';

const encryptionKey = randomBytes(32);
const token = 'worker-collector-secret';
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
  await db.delete(schema.resources);
  await db.delete(schema.providerAccounts);
  await db.delete(schema.jobs);
});

async function insertAccount(): Promise<string> {
  const [account] = await db
    .insert(schema.providerAccounts)
    .values({
      provider: 'github',
      name: 'octocat',
      encryptedToken: encrypt(token, encryptionKey),
    })
    .returning({ id: schema.providerAccounts.id });
  return account!.id;
}

function job(accountId: string): JobRecord {
  return {
    id: 'job-id',
    type: 'github.sync',
    payload: { accountId },
    attempts: 1,
    maxAttempts: 3,
  };
}

function collector(resources: ExternalResource[]): ProviderCollector {
  return {
    provider: 'github',
    testConnection: vi.fn(),
    listResources: vi.fn().mockResolvedValue(resources),
  };
}

describe('GitHub sync handler', () => {
  it('관측된 자원을 upsert하고 사라진 자원은 삭제 표시만 한다', async () => {
    const accountId = await insertAccount();
    await db.insert(schema.resources).values([
      {
        provider: 'github',
        providerAccountId: accountId,
        externalId: 'octocat/current',
        resourceType: 'github_repository',
        name: 'old-name',
        metadata: {},
        deletedAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        provider: 'github',
        providerAccountId: accountId,
        externalId: 'octocat/missing',
        resourceType: 'github_repository',
        name: 'missing',
        metadata: {},
      },
    ]);
    const resources: ExternalResource[] = [
      {
        provider: 'github',
        externalId: 'octocat/current',
        resourceType: 'github_repository',
        name: 'current',
        status: 'active',
        url: 'https://github.com/octocat/current',
        metadata: { defaultBranch: 'main' },
        observedAt: '2026-07-20T10:00:00Z',
      },
    ];
    const createCollector = vi.fn(() => collector(resources));

    await createGithubSyncHandler(db, encryptionKey, {
      createCollector,
    })(job(accountId));

    expect(createCollector).toHaveBeenCalledWith(token);
    const rows = await db
      .select()
      .from(schema.resources)
      .orderBy(asc(schema.resources.externalId));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      externalId: 'octocat/current',
      name: 'current',
      deletedAt: null,
    });
    expect(rows[1]?.externalId).toBe('octocat/missing');
    expect(rows[1]?.deletedAt).toBeInstanceOf(Date);
  });

  it('수집 오류에는 토큰이나 원본 오류를 저장하지 않는다', async () => {
    const accountId = await insertAccount();
    const createCollector = vi.fn(() => ({
      ...collector([]),
      listResources: vi
        .fn()
        .mockRejectedValue(new Error(`request failed with ${token}`)),
    }));

    await expect(
      createGithubSyncHandler(db, encryptionKey, {
        createCollector,
      })(job(accountId)),
    ).rejects.toThrow('GitHub 동기화에 실패했습니다.');

    const [account] = await db
      .select()
      .from(schema.providerAccounts)
      .where(eq(schema.providerAccounts.id, accountId));
    expect(account?.lastError).toBe('GitHub 동기화에 실패했습니다.');
    expect(account?.lastError).not.toContain(token);
  });

  it('GitHub 계정마다 DB 시각 기준 즉시 실행 job을 넣는다', async () => {
    const accountId = await insertAccount();

    await enqueueGithubSyncJobs(db);

    const queued = await db.select().from(schema.jobs);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      type: 'github.sync',
      payload: { accountId },
      status: 'pending',
    });
  });
});
