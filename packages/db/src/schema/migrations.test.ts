import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const providerAccountMigrationUrl = new URL(
  '../../../../drizzle/0007_bizarre_firedrake.sql',
  import.meta.url,
);

const componentHealthUrlMigrationUrl = new URL(
  '../../../../drizzle/0008_component_health_url.sql',
  import.meta.url,
);

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\n$/, '');
}

describe('provider account migration', () => {
  it('adds only the nullable external account ID column', async () => {
    const migration = await readFile(providerAccountMigrationUrl, 'utf8');

    expect(normalizeLineEndings(migration)).toBe(
      'ALTER TABLE "provider_accounts" ADD COLUMN "external_account_id" text;',
    );
  });
});

describe('component health URL migration', () => {
  it('adds only the nullable health URL column', async () => {
    const migration = await readFile(componentHealthUrlMigrationUrl, 'utf8');

    expect(normalizeLineEndings(migration)).toBe(
      'ALTER TABLE "components" ADD COLUMN "health_url" text;',
    );
  });
});
