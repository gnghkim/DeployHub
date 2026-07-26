import { createDb } from '@deployhub/db';

const { db } = createDb(process.env.DATABASE_URL ?? '');

export { db };
