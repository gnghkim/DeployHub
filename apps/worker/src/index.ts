import { randomUUID } from 'node:crypto';
import { createDb } from '@deployhub/db';
import { loadEnv } from '@deployhub/shared';
import { createRunner } from './runner.js';

const POLL_INTERVAL_MS = 5_000;

async function main(): Promise<void> {
  const env = loadEnv(process.env);
  const { db, close } = createDb(env.DATABASE_URL);
  const workerId = `worker-${randomUUID().slice(0, 8)}`;
  const runner = createRunner(db, {}, workerId);

  let running = true;
  const shutdown = (signal: string): void => {
    console.log(`[worker] ${signal} 수신. 현재 배치를 마치고 종료합니다.`);
    running = false;
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

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
