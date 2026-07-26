import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { startTestDb } from '@deployhub/db/test/helpers/pg.js';
import { enqueue, schema, type Db } from '@deployhub/db';
import { createRunner } from './runner';

let db: Db;
let stop: () => Promise<void>;

beforeAll(async () => {
  const started = await startTestDb();
  db = started.db;
  stop = started.stop;
}, 120_000);

afterAll(async () => { await stop(); });
beforeEach(async () => { await db.delete(schema.jobs); });

describe('runner', () => {
  it('등록된 핸들러로 job을 처리하고 succeeded로 만든다', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const job = await enqueue(db, { type: 'sync.github', payload: { id: 1 } });

    const runner = createRunner(db, { 'sync.github': handler }, 'worker-1');
    const result = await runner.runOnce();

    expect(result).toEqual({ claimed: 1, succeeded: 1, failed: 0 });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]?.[0]?.payload).toEqual({ id: 1 });

    const [row] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(row?.status).toBe('succeeded');
  });

  it('핸들러가 던지면 job을 실패 처리하고 루프는 계속된다', async () => {
    await enqueue(db, { type: 'sync.github', maxAttempts: 3 });
    await enqueue(db, { type: 'sync.github', maxAttempts: 3 });

    const handler = vi.fn().mockRejectedValue(new Error('boom'));
    const runner = createRunner(db, { 'sync.github': handler }, 'worker-1');
    const result = await runner.runOnce();

    expect(result).toEqual({ claimed: 2, succeeded: 0, failed: 2 });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('핸들러가 없는 type은 실패로 기록하고 사유를 남긴다', async () => {
    const job = await enqueue(db, { type: 'unknown.task', maxAttempts: 1 });
    const runner = createRunner(db, {}, 'worker-1');
    const result = await runner.runOnce();

    expect(result.failed).toBe(1);
    const [row] = await db.select().from(schema.jobs).where(eq(schema.jobs.id, job.id));
    expect(row?.status).toBe('failed');
    expect(row?.lastError).toMatch(/unknown\.task/);
  });

  it('처리할 job이 없으면 0을 반환한다', async () => {
    const runner = createRunner(db, {}, 'worker-1');
    expect(await runner.runOnce()).toEqual({ claimed: 0, succeeded: 0, failed: 0 });
  });
});
