import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { startTestDb } from '../../test/helpers/pg';
import { schema, type Db } from '../index';
import { claim, complete, enqueue, enqueueUnique, fail } from './queue';

let db: Db;
let stop: () => Promise<void>;

describe('enqueueUnique', () => {
  it('does not insert when the same type is pending', async () => {
    await enqueue(db, { type: 'sync.github' });

    await expect(enqueueUnique(db, { type: 'sync.github' })).resolves.toBe(false);
    expect(await db.select().from(schema.jobs)).toHaveLength(1);
  });

  it('does not insert when the same type is running', async () => {
    await enqueue(db, { type: 'sync.github' });
    await claim(db, 'worker-1', 1, 60);

    await expect(enqueueUnique(db, { type: 'sync.github' })).resolves.toBe(false);
  });

  it('inserts when same-type jobs are terminal', async () => {
    const succeeded = await enqueue(db, { type: 'sync.github' });
    await claim(db, 'worker-1', 1, 60);
    await complete(db, succeeded.id);

    const failed = await enqueue(db, { type: 'sync.github', maxAttempts: 1 });
    await claim(db, 'worker-1', 1, 60);
    await fail(db, failed.id, 'test failure');

    await expect(enqueueUnique(db, { type: 'sync.github' })).resolves.toBe(true);
    expect(await db.select().from(schema.jobs)).toHaveLength(3);
  });

  it('is not blocked by a different job type', async () => {
    await enqueue(db, { type: 'sync.github' });

    await expect(enqueueUnique(db, { type: 'sync.vercel' })).resolves.toBe(true);
    expect(await db.select().from(schema.jobs)).toHaveLength(2);
  });

  it('does not alter enqueue unconditional behavior', async () => {
    await enqueue(db, { type: 'sync.github' });
    await enqueue(db, { type: 'sync.github' });

    expect(await db.select().from(schema.jobs)).toHaveLength(2);
  });
});

beforeAll(async () => {
  const started = await startTestDb();
  db = started.db;
  stop = started.stop;
}, 120_000);

afterAll(async () => { await stop(); });
beforeEach(async () => { await db.delete(schema.jobs); });

describe('job 큐', () => {
  it('넣은 job을 claim한다', async () => {
    await enqueue(db, { type: 'sync.github', payload: { accountId: 'a1' } });
    const claimed = await claim(db, 'worker-1', 10, 60);
    expect(claimed).toHaveLength(1);
    expect(claimed[0]?.type).toBe('sync.github');
    expect(claimed[0]?.payload).toEqual({ accountId: 'a1' });
  });

  it('두 워커가 동시에 claim해도 같은 job을 중복해서 가져가지 않는다', async () => {
    for (let i = 0; i < 20; i += 1) {
      await enqueue(db, { type: 'sync.github', payload: { i } });
    }

    const [a, b] = await Promise.all([
      claim(db, 'worker-a', 20, 60),
      claim(db, 'worker-b', 20, 60),
    ]);

    const ids = [...(a ?? []), ...(b ?? [])].map((j) => j.id);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });

  it('run_at이 미래인 job은 claim하지 않는다', async () => {
    await enqueue(db, {
      type: 'sync.github',
      runAt: new Date(Date.now() + 60_000),
    });
    const claimed = await claim(db, 'worker-1', 10, 60);
    expect(claimed).toHaveLength(0);
  });

  it('lease가 만료된 running job을 회수한다', async () => {
    const job = await enqueue(db, { type: 'sync.github' });
    await claim(db, 'worker-dead', 10, 60);

    // lease를 강제로 만료시킨다
    await db
      .update(schema.jobs)
      .set({ lockedAt: new Date(Date.now() - 120_000) })
      .where(eq(schema.jobs.id, job.id));

    const reclaimed = await claim(db, 'worker-alive', 10, 60);
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]?.id).toBe(job.id);
    expect(reclaimed[0]?.attempts).toBe(2);
  });

  it('claim은 attempts를 증가시킨다', async () => {
    await enqueue(db, { type: 'sync.github' });
    const claimed = await claim(db, 'worker-1', 10, 60);
    expect(claimed[0]?.attempts).toBe(1);
  });

  it('complete한 job은 다시 claim되지 않는다', async () => {
    const job = await enqueue(db, { type: 'sync.github' });
    await claim(db, 'worker-1', 10, 60);
    await complete(db, job.id);

    const again = await claim(db, 'worker-1', 10, 60);
    expect(again).toHaveLength(0);

    const [row] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(row?.status).toBe('succeeded');
  });

  it('maxAttempts에 도달하지 않은 실패는 pending으로 되돌린다', async () => {
    const job = await enqueue(db, { type: 'sync.github', maxAttempts: 3 });
    await claim(db, 'worker-1', 10, 60);
    await fail(db, job.id, '502 Bad Gateway');

    const [row] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(row?.status).toBe('pending');
    expect(row?.lastError).toBe('502 Bad Gateway');
    expect(row?.lockedBy).toBeNull();

    const again = await claim(db, 'worker-1', 10, 60);
    expect(again).toHaveLength(1);
  });

  it('maxAttempts에 도달한 실패는 failed로 확정하고 다시 claim하지 않는다', async () => {
    const job = await enqueue(db, { type: 'sync.github', maxAttempts: 1 });
    await claim(db, 'worker-1', 10, 60);
    await fail(db, job.id, '401 Unauthorized');

    const [row] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(row?.status).toBe('failed');

    const again = await claim(db, 'worker-1', 10, 60);
    expect(again).toHaveLength(0);
  });

  it('limit을 넘겨 claim하지 않는다', async () => {
    for (let i = 0; i < 5; i += 1) await enqueue(db, { type: 'sync.github' });
    const claimed = await claim(db, 'worker-1', 2, 60);
    expect(claimed).toHaveLength(2);
  });
});
