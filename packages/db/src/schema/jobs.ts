import { sql } from 'drizzle-orm';
import {
  index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import { jobStatus } from './enums';

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    dedupeKey: text('dedupe_key'),
    payload: jsonb('payload').notNull().default({}),
    status: jobStatus('status').notNull().default('pending'),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    lastError: text('last_error'),
    trailingPayload: jsonb('trailing_payload').$type<Record<string, unknown>>(),
    trailingMaxAttempts: integer('trailing_max_attempts'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('jobs_claim_idx').on(t.status, t.runAt),
    uniqueIndex('jobs_active_dedupe_unique')
      .on(t.type, t.dedupeKey)
      .where(sql`${t.dedupeKey} IS NOT NULL AND ${t.status} IN ('pending', 'running')`),
  ],
);
