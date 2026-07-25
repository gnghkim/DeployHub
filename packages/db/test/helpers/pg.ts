import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb, type Db } from '../../src/index.js';

export type TestDb = { db: Db; connectionString: string };

let container: StartedPostgreSqlContainer | undefined;

export async function startTestDb(): Promise<TestDb & { stop: () => Promise<void> }> {
  container = await new PostgreSqlContainer('postgres:17-alpine').start();
  const connectionString = container.getConnectionUri();
  const { db, close } = createDb(connectionString);
  await migrate(db, { migrationsFolder: 'drizzle' });
  return {
    db,
    connectionString,
    stop: async () => {
      await close();
      await container?.stop();
    },
  };
}
