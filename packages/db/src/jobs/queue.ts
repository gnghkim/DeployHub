import { sql } from 'drizzle-orm';
import type { Db } from '../client';
import type { EnqueueOptions, JobRecord } from './types';

export type SnapshotCaptureTrailingOptions = {
  projectId: string;
  payload: Record<string, unknown>;
  maxAttempts?: number;
};

type SqlExecutor = Pick<Db, 'execute'>;

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

export async function coalesceSnapshotCaptureJob(
  executor: SqlExecutor,
  options: SnapshotCaptureTrailingOptions,
): Promise<boolean> {
  const dedupeKey = `snapshot:${options.projectId}`;
  const payload = JSON.stringify(options.payload);
  const maxAttempts = options.maxAttempts ?? 3;
  await executor.execute(sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${dedupeKey}, 0))
  `);
  const [active] = (await executor.execute<{
    id: string;
    status: 'pending' | 'running';
  }>(sql`
    SELECT id, status
    FROM jobs
    WHERE type = 'snapshot.capture'
      AND dedupe_key = ${dedupeKey}
      AND status IN ('pending', 'running')
    FOR UPDATE
    LIMIT 1
  `)).rows;

  if (active?.status === 'pending') {
    await executor.execute(sql`
      UPDATE jobs
      SET payload = ${payload}::jsonb,
          run_at = now(),
          attempts = 0,
          max_attempts = ${maxAttempts},
          last_error = NULL,
          trailing_payload = NULL,
          trailing_max_attempts = NULL,
          updated_at = now()
      WHERE id = ${active.id}
    `);
    return false;
  }
  if (active?.status === 'running') {
    await executor.execute(sql`
      UPDATE jobs
      SET trailing_payload = ${payload}::jsonb,
          trailing_max_attempts = ${maxAttempts},
          updated_at = now()
      WHERE id = ${active.id}
    `);
    return true;
  }

  const inserted = await executor.execute<{
    inserted: boolean;
    status: 'pending' | 'running';
  }>(sql`
    INSERT INTO jobs (type, dedupe_key, payload, max_attempts)
    VALUES ('snapshot.capture', ${dedupeKey}, ${payload}::jsonb, ${maxAttempts})
    ON CONFLICT (type, dedupe_key)
      WHERE dedupe_key IS NOT NULL AND status IN ('pending', 'running')
      DO UPDATE SET
        payload = CASE
          WHEN jobs.status = 'pending' THEN EXCLUDED.payload
          ELSE jobs.payload
        END,
        run_at = CASE
          WHEN jobs.status = 'pending' THEN now()
          ELSE jobs.run_at
        END,
        attempts = CASE
          WHEN jobs.status = 'pending' THEN 0
          ELSE jobs.attempts
        END,
        max_attempts = CASE
          WHEN jobs.status = 'pending' THEN EXCLUDED.max_attempts
          ELSE jobs.max_attempts
        END,
        last_error = CASE
          WHEN jobs.status = 'pending' THEN NULL
          ELSE jobs.last_error
        END,
        trailing_payload = CASE
          WHEN jobs.status = 'running' THEN EXCLUDED.payload
          ELSE NULL
        END,
        trailing_max_attempts = CASE
          WHEN jobs.status = 'running' THEN EXCLUDED.max_attempts
          ELSE NULL
        END,
        updated_at = now()
    RETURNING (xmax = 0) AS inserted, status
  `);
  const result = inserted.rows[0];
  if (!result) throw new Error('snapshot trailing enqueue failed');
  return result.inserted || result.status === 'running';
}

export async function enqueueSnapshotCaptureTrailing(
  db: Db,
  options: SnapshotCaptureTrailingOptions,
): Promise<boolean> {
  return db.transaction((tx) => coalesceSnapshotCaptureJob(tx, options));
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

type OwnedJobRow = {
  id: string;
  type: string;
  dedupe_key: string | null;
  attempts: number;
  max_attempts: number;
  trailing_payload: Record<string, unknown> | null;
  trailing_max_attempts: number | null;
};

async function lockOwnedJob(
  executor: SqlExecutor,
  jobId: string,
  workerId: string,
): Promise<OwnedJobRow | undefined> {
  const [candidate] = (await executor.execute<{
    type: string;
    dedupe_key: string | null;
  }>(sql`
    SELECT type, dedupe_key
    FROM jobs
    WHERE id = ${jobId}
      AND status = 'running'
      AND locked_by = ${workerId}
  `)).rows;
  if (!candidate) return undefined;
  if (candidate.type === 'snapshot.capture' && candidate.dedupe_key !== null) {
    await executor.execute(sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${candidate.dedupe_key}, 0)
      )
    `);
  }
  const [owned] = (await executor.execute<OwnedJobRow>(sql`
    SELECT id, type, dedupe_key, attempts, max_attempts,
           trailing_payload, trailing_max_attempts
    FROM jobs
    WHERE id = ${jobId}
      AND status = 'running'
      AND locked_by = ${workerId}
    FOR UPDATE
  `)).rows;
  return owned;
}

async function promoteTrailing(
  executor: SqlExecutor,
  job: OwnedJobRow,
): Promise<void> {
  if (
    job.type !== 'snapshot.capture'
    || job.dedupe_key === null
    || job.trailing_payload === null
  ) {
    return;
  }
  await executor.execute(sql`
    INSERT INTO jobs (type, dedupe_key, payload, max_attempts)
    VALUES (
      'snapshot.capture',
      ${job.dedupe_key},
      ${JSON.stringify(job.trailing_payload)}::jsonb,
      ${job.trailing_max_attempts ?? 3}
    )
  `);
}

export async function complete(
  db: Db,
  jobId: string,
  workerId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const owned = await lockOwnedJob(tx, jobId, workerId);
    if (!owned) return false;
    await tx.execute(sql`
      UPDATE jobs
      SET status = 'succeeded',
          trailing_payload = NULL,
          trailing_max_attempts = NULL,
          locked_at = NULL,
          locked_by = NULL,
          updated_at = now()
      WHERE id = ${jobId}
    `);
    await promoteTrailing(tx, owned);
    return true;
  });
}

export async function fail(
  db: Db,
  jobId: string,
  workerId: string,
  error: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const owned = await lockOwnedJob(tx, jobId, workerId);
    if (!owned) return false;
    const terminal = owned.attempts >= owned.max_attempts;
    await tx.execute(sql`
      UPDATE jobs
      SET status = ${terminal ? 'failed' : 'pending'}::job_status,
          last_error = ${error},
          trailing_payload = CASE
            WHEN ${terminal} THEN NULL
            ELSE trailing_payload
          END,
          trailing_max_attempts = CASE
            WHEN ${terminal} THEN NULL
            ELSE trailing_max_attempts
          END,
          locked_at = NULL,
          locked_by = NULL,
          updated_at = now()
      WHERE id = ${jobId}
    `);
    if (terminal) await promoteTrailing(tx, owned);
    return true;
  });
}
