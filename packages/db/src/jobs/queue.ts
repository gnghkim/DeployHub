import { sql } from 'drizzle-orm';
import type { Db } from '../client';
import type { EnqueueOptions, JobRecord } from './types';

type JobRow = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

function toRecord(row: JobRow): JobRecord {
  return {
    id: row.id,
    type: row.type,
    payload: row.payload,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
  };
}

export async function enqueue(db: Db, options: EnqueueOptions): Promise<JobRecord> {
  const result = await db.execute<JobRow>(sql`
    INSERT INTO jobs (type, dedupe_key, payload, run_at, max_attempts)
    VALUES (
      ${options.type},
      ${options.dedupeKey ?? null},
      ${JSON.stringify(options.payload ?? {})}::jsonb,
      ${options.runAt ?? sql`now()`},
      ${options.maxAttempts ?? 3}
    )
    RETURNING id, type, payload, attempts, max_attempts
  `);
  const row = result.rows[0];
  if (!row) throw new Error('job enqueue가 행을 반환하지 않았습니다.');
  return toRecord(row);
}

/** Do not insert if the same type and dedupe key has a pending or running job. */
export async function enqueueUnique(db: Db, options: EnqueueOptions): Promise<boolean> {
  const result = await db.execute<{ id: string }>(sql`
    INSERT INTO jobs (type, dedupe_key, payload, run_at, max_attempts)
    VALUES (
      ${options.type},
      ${options.dedupeKey ?? '__global__'},
      ${JSON.stringify(options.payload ?? {})}::jsonb,
      now(),
      ${options.maxAttempts ?? 3}
    )
    ON CONFLICT (type, dedupe_key)
      WHERE dedupe_key IS NOT NULL AND status IN ('pending', 'running')
      DO NOTHING
    RETURNING id
  `);
  return result.rows.length > 0;
}

export async function claim(
  db: Db,
  workerId: string,
  limit: number,
  leaseSeconds: number,
): Promise<JobRecord[]> {
  const result = await db.execute<JobRow>(sql`
    UPDATE jobs
    SET status     = 'running',
        locked_at  = now(),
        locked_by  = ${workerId},
        attempts   = attempts + 1,
        updated_at = now()
    WHERE id IN (
      SELECT id FROM jobs
      WHERE (status = 'pending' AND run_at <= now())
         OR (status = 'running'
             AND locked_at < now() - ${leaseSeconds} * interval '1 second')
      ORDER BY run_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${limit}
    )
    RETURNING id, type, payload, attempts, max_attempts
  `);
  return result.rows.map(toRecord);
}

export async function complete(db: Db, jobId: string): Promise<void> {
  await db.execute(sql`
    UPDATE jobs
    SET status = 'succeeded', locked_at = NULL, locked_by = NULL, updated_at = now()
    WHERE id = ${jobId}
  `);
}

export async function fail(db: Db, jobId: string, error: string): Promise<void> {
  await db.execute(sql`
    UPDATE jobs
    SET status = CASE WHEN attempts >= max_attempts THEN 'failed'::job_status
                      ELSE 'pending'::job_status END,
        last_error = ${error},
        locked_at  = NULL,
        locked_by  = NULL,
        updated_at = now()
    WHERE id = ${jobId}
  `);
}
