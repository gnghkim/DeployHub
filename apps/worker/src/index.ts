import { randomUUID } from 'node:crypto';
import { createDb } from '@deployhub/db';
import { loadEncryptionKey, loadEnv } from '@deployhub/shared';
import {
  createGithubSyncHandler,
  enqueueGithubSyncJobs,
} from './handlers';
import { createRunner } from './runner';

const POLL_INTERVAL_MS = 5_000;
const GITHUB_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1_000;

async function main(): Promise<void> {
  const env = loadEnv(process.env);
  const encryptionKey = loadEncryptionKey(env.ENCRYPTION_KEY);
  const { db, close } = createDb(env.DATABASE_URL);
  const workerId = `worker-${randomUUID().slice(0, 8)}`;
  const runner = createRunner(
    db,
    {
      'github.sync': createGithubSyncHandler(db, encryptionKey),
    },
    workerId,
  );

  let running = true;
  const githubSchedule = setInterval(() => {
    void enqueueGithubSyncJobs(db).catch(() => {
      console.error('[worker] GitHub 동기화 job 등록 실패');
    });
  }, GITHUB_SYNC_INTERVAL_MS);
  const shutdown = (signal: string): void => {
    console.log(`[worker] ${signal} 수신. 현재 배치를 마치고 종료합니다.`);
    running = false;
    clearInterval(githubSchedule);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await enqueueGithubSyncJobs(db);
  console.log(`[worker] 시작 ${workerId}`);
  while (running) {
    try {
      const result = await runner.runOnce();
      if (result.claimed > 0) console.log('[worker]', result);
    } catch (error) {
      console.error('[worker] 배치 실패', error);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  await close();
  console.log('[worker] 종료');
}

void main();
