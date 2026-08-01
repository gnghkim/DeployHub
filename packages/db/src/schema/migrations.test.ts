import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const migrationUrl = new URL(
  '../../../../drizzle/0008_component_health_url.sql',
  import.meta.url,
);

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\n$/, '');
}

describe('component health URL migration', () => {
  it('adds only the nullable health URL column', async () => {
    const migration = await readFile(migrationUrl, 'utf8');

    expect(normalizeLineEndings(migration)).toBe(
      'ALTER TABLE "components" ADD COLUMN "health_url" text;',
    );
  });
});
