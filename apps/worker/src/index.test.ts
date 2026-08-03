import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./index.ts', import.meta.url)),
  'utf8',
);

describe('worker provider schedules', () => {
  it('registers, schedules, starts, and clears Supabase sync', () => {
    expect(source).toContain(
      "'supabase.sync': createSupabaseSyncHandler(db, encryptionKey)",
    );
    expect(source).toMatch(
      /const supabaseSchedule = setInterval\([\s\S]*?enqueueSupabaseSyncJobs\(db\)[\s\S]*?PROVIDER_SYNC_INTERVAL_MS/,
    );
    expect(source).toContain('await enqueueSupabaseSyncJobs(db)');
    expect(source).toContain('clearInterval(supabaseSchedule)');
  });
});
