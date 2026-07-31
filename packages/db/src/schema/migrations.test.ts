import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migrationUrl = new URL(
  '../../../../drizzle/0007_bizarre_firedrake.sql',
  import.meta.url,
);

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\n$/, '');
}

describe('provider account migrations', () => {
  it('adds only the nullable external account ID column', async () => {
    const migration = await readFile(migrationUrl, 'utf8');

    expect(normalizeLineEndings(migration)).toBe(
      'ALTER TABLE "provider_accounts" ADD COLUMN "external_account_id" text;',
    );
  });
});
