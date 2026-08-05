import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index';

export type Db = NodePgDatabase<typeof schema>;

/**
 * 트랜잭션 안팎 어디서나 쓸 수 있는 질의 실행자.
 * drizzle 이 트랜잭션 핸들 타입을 따로 export 하지 않으므로
 * `transaction` 콜백의 첫 인자 타입에서 끌어온다.
 */
export type DbExecutor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

export function createDb(connectionString: string): {
  db: Db;
  close: () => Promise<void>;
} {
  const pool = new pg.Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { db, close: () => pool.end() };
}
