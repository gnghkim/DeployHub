import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { startTestDb } from '../../test/helpers/pg';
import { schema, type Db } from '../index';
import {
  claim,
  complete,
  enqueue,
  enqueueSnapshotCaptureTrailing,
  enqueueUnique,
  fail,
} from './queue';

let db: Db;
let stop: () => Promise<void>;

describe('enqueueUnique', () => {
  it('coalesces a pending snapshot job to the latest payload', async () => {
    const projectId = crypto.randomUUID();
    await expect(enqueueSnapshotCaptureTrailing(db, {
      projectId,
      payload: { projectId, url: 'https://old.example' },
    })).resolves.toBe(true);

    await expect(enqueueSnapshotCaptureTrailing(db, {
      projectId,
      payload: { projectId, url: 'https://latest.example' },
    })).resolves.toBe(false);

    expect(await db.select().from(schema.jobs)).toEqual([
      expect.objectContaining({
        status: 'pending',
        dedupeKey: `snapshot:${projectId}`,
        payload: { projectId, url: 'https://latest.example' },
      }),
    ]);
  });

  it('moves a running snapshot aside and guarantees one trailing job', async () => {
    const projectId = crypto.randomUUID();
    await enqueueSnapshotCaptureTrailing(db, {
      projectId,
      payload: { projectId, url: 'https://old.example' },
    });
    const [running] = await claim(db, 'snapshot-worker', 1, 60);
    if (!running) throw new Error('expected a running snapshot job');

    await expect(enqueueSnapshotCaptureTrailing(db, {
      projectId,
      payload: { projectId, url: 'https://latest.example' },
    })).resolves.toBe(true);

    expect(await db.select().from(schema.jobs)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: running.id,
        status: 'running',
        dedupeKey: null,
        attempts: 1,
        maxAttempts: 1,
      }),
      expect.objectContaining({
        status: 'pending',
        dedupeKey: `snapshot:${projectId}`,
        payload: { projectId, url: 'https://latest.example' },
      }),
    ]));
  });

  it('keeps at most one active keyed snapshot across parallel calls', async () => {
    const projectId = crypto.randomUUID();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) => (
        enqueueSnapshotCaptureTrailing(db, {
          projectId,
          payload: { projectId, url: `https://${index}.example` },
        })
      )),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    const active = await db.select().from(schema.jobs);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      status: 'pending',
      dedupeKey: `snapshot:${projectId}`,
    });
  });

  it('does not retry a superseded transient job alongside its trailing job', async () => {
    const projectId = crypto.randomUUID();
    await enqueueSnapshotCaptureTrailing(db, {
      projectId,
      payload: { projectId, url: 'https://old.example' },
    });
    const [running] = await claim(db, 'snapshot-worker', 1, 60);
    if (!running) throw new Error('expected a running snapshot job');
    await enqueueSnapshotCaptureTrailing(db, {
      projectId,
      payload: { projectId, url: 'https://latest.example' },
    });

    await fail(db, running.id, 'snapshot capture failed: navigation_failed');

    const rows = await db.select().from(schema.jobs);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: running.id, status: 'failed' }),
      expect.objectContaining({
        status: 'pending',
        dedupeKey: `snapshot:${projectId}`,
        payload: { projectId, url: 'https://latest.example' },
      }),
    ]));
    const retry = await claim(db, 'next-worker', 10, 60);
    expect(retry).toHaveLength(1);
    expect(retry[0]?.payload).toEqual({
      projectId,
      url: 'https://latest.example',
    });
  });

  it('allows only one concurrent pending job for the same type and dedupe key', async () => {
    await db.execute(`
      CREATE FUNCTION delay_job_insert() RETURNS trigger AS $$
      BEGIN
        PERFORM pg_sleep(0.1);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await db.execute(`
      CREATE TRIGGER delay_job_insert
      BEFORE INSERT ON jobs
      FOR EACH ROW EXECUTE FUNCTION delay_job_insert()
    `);

    let inserted: boolean[];
    try {
      inserted = await Promise.all(
        Array.from({ length: 10 }, () => enqueueUnique(db, {
          type: 'snapshot.capture',
          dedupeKey: 'snapshot:project-1',
        })),
      );
    } finally {
      await db.execute('DROP TRIGGER delay_job_insert ON jobs');
      await db.execute('DROP FUNCTION delay_job_insert()');
    }

    expect(inserted.filter(Boolean)).toHaveLength(1);
    expect(await db.select().from(schema.jobs)).toHaveLength(1);
  });

  it('does not insert the same type and dedupe key while the job is running', async () => {
    await enqueueUnique(db, {
      type: 'snapshot.capture',
      dedupeKey: 'snapshot:project-1',
    });
    await claim(db, 'worker-1', 1, 60);

    await expect(enqueueUnique(db, {
      type: 'snapshot.capture',
      dedupeKey: 'snapshot:project-1',
    })).resolves.toBe(false);
  });

  it('allows a different project dedupe key for the same type', async () => {
    await expect(enqueueUnique(db, {
      type: 'snapshot.capture',
      dedupeKey: 'snapshot:project-1',
    })).resolves.toBe(true);
    await expect(enqueueUnique(db, {
      type: 'snapshot.capture',
      dedupeKey: 'snapshot:project-2',
    })).resolves.toBe(true);

    expect(await db.select().from(schema.jobs)).toHaveLength(2);
  });

  it('releases a type and dedupe key after the job completes', async () => {
    await enqueueUnique(db, {
      type: 'snapshot.capture',
      dedupeKey: 'snapshot:project-1',
    });
    const [succeeded] = await claim(db, 'worker-1', 1, 60);
    if (!succeeded) throw new Error('expected a claimed job');
    await complete(db, succeeded.id);

    await expect(enqueueUnique(db, {
      type: 'snapshot.capture',
      dedupeKey: 'snapshot:project-1',
    })).resolves.toBe(true);
    expect(await db.select().from(schema.jobs)).toHaveLength(2);
  });

  it('retains global-by-type behavior when no dedupe key is supplied', async () => {
    await expect(enqueueUnique(db, { type: 'sync.github' })).resolves.toBe(true);
    await expect(enqueueUnique(db, { type: 'sync.github' })).resolves.toBe(false);

    await expect(enqueueUnique(db, { type: 'sync.vercel' })).resolves.toBe(true);
    expect(await db.select().from(schema.jobs)).toHaveLength(2);
  });

  it('inserts without a key when global same-type jobs are terminal', async () => {
    await enqueueUnique(db, { type: 'sync.github' });
    const [succeeded] = await claim(db, 'worker-1', 1, 60);
    if (!succeeded) throw new Error('expected a claimed job');
    await complete(db, succeeded.id);

    await enqueueUnique(db, { type: 'sync.github', maxAttempts: 1 });
    await claim(db, 'worker-1', 1, 60);
    const [running] = await db.select().from(schema.jobs).where(eq(schema.jobs.status, 'running'));
    if (!running) throw new Error('expected a running job');
    await fail(db, running.id, 'test failure');

    await expect(enqueueUnique(db, { type: 'sync.github' })).resolves.toBe(true);
    expect(await db.select().from(schema.jobs)).toHaveLength(3);
  });

  it('stores an optional dedupe key for unconditional enqueue', async () => {
    const job = await enqueue(db, {
      type: 'snapshot.capture',
      dedupeKey: 'snapshot:project-1',
    });

    const [row] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(row?.dedupeKey).toBe('snapshot:project-1');
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
