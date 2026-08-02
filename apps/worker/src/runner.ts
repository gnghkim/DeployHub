import { claim, complete, fail, type Db, type JobRecord } from '@deployhub/db';

export type JobHandler = (job: JobRecord) => Promise<void>;
export type HandlerRegistry = Record<string, JobHandler>;

export type RunResult = { claimed: number; succeeded: number; failed: number };

const BATCH_SIZE = 10;
const LEASE_SECONDS = 300;

export function createRunner(
  db: Db,
  handlers: HandlerRegistry,
  workerId: string,
): { runOnce: () => Promise<RunResult> } {
  async function runOnce(): Promise<RunResult> {
    const jobs = await claim(db, workerId, BATCH_SIZE, LEASE_SECONDS);
    let succeeded = 0;
    let failed = 0;

    for (const job of jobs) {
      const handler = handlers[job.type];
      if (!handler) {
        if (await fail(
          db,
          job.id,
          workerId,
          `등록된 핸들러가 없습니다: ${job.type}`,
        )) {
          failed += 1;
        }
        continue;
      }
      try {
        await handler(job);
        if (await complete(db, job.id, workerId)) succeeded += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (await fail(db, job.id, workerId, message)) failed += 1;
      }
    }

    return { claimed: jobs.length, succeeded, failed };
  }

  return { runOnce };
}
