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

const projectSnapshotsMigrationUrl = new URL(
  '../../../../drizzle/0009_project_snapshots.sql',
  import.meta.url,
);

const snapshotTrailingMigrationUrl = new URL(
  '../../../../drizzle/0010_typical_moondragon.sql',
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

describe('project snapshots migration', () => {
  it('adds the complete snapshot schema and active job deduplication safely', async () => {
    const migration = await readFile(projectSnapshotsMigrationUrl, 'utf8');

    expect(migration).toContain(
      `CREATE TYPE "public"."snapshot_mode" AS ENUM('disabled', 'automatic', 'manual');`,
    );
    expect(migration).toContain(
      `CREATE TYPE "public"."snapshot_source" AS ENUM('automatic', 'manual');`,
    );
    expect(migration).toContain(
      `CREATE TYPE "public"."snapshot_attempt_status" AS ENUM('pending', 'success', 'failed');`,
    );
    expect(migration).toContain('CREATE TABLE "project_snapshots"');

    const snapshotColumns = [
      /"project_id" uuid PRIMARY KEY NOT NULL/,
      /"image_data" "bytea"/,
      /"content_type" text/,
      /"width" integer/,
      /"height" integer/,
      /"source" "snapshot_source"/,
      /"source_url" text/,
      /"deployment_id" uuid/,
      /"checksum" text/,
      /"captured_at" timestamp with time zone/,
      /"last_attempt_at" timestamp with time zone/,
      /"last_attempt_status" "snapshot_attempt_status"/,
      /"last_error" text/,
      /"updated_at" timestamp with time zone DEFAULT now\(\) NOT NULL/,
    ];
    for (const column of snapshotColumns) expect(migration).toMatch(column);

    expect(migration).toContain(
      'ALTER TABLE "projects" ADD COLUMN "snapshot_url" text;',
    );
    expect(migration).toContain(
      `ALTER TABLE "projects" ADD COLUMN "snapshot_mode" "snapshot_mode" DEFAULT 'disabled' NOT NULL;`,
    );
    expect(migration).toContain(
      'ALTER TABLE "jobs" ADD COLUMN "dedupe_key" text;',
    );
    expect(migration).toMatch(
      /ALTER TABLE "project_snapshots" ADD CONSTRAINT "project_snapshots_project_id_projects_id_fk" FOREIGN KEY \("project_id"\) REFERENCES "public"\."projects"\("id"\) ON DELETE cascade ON UPDATE no action;/,
    );
    expect(migration).toMatch(
      /ALTER TABLE "project_snapshots" ADD CONSTRAINT "project_snapshots_deployment_id_deployments_id_fk" FOREIGN KEY \("deployment_id"\) REFERENCES "public"\."deployments"\("id"\) ON DELETE set null ON UPDATE no action;/,
    );
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX "jobs_active_dedupe_unique" ON "jobs" USING btree \("type","dedupe_key"\) WHERE .*"dedupe_key" IS NOT NULL AND .*"status" IN \('pending', 'running'\);/,
    );
    expect(migration).not.toMatch(/\b(?:DROP TABLE|DROP COLUMN|TRUNCATE)\b/i);
  });
});

describe('snapshot trailing migration', () => {
  it('adds only nullable trailing job fields', async () => {
    const migration = await readFile(snapshotTrailingMigrationUrl, 'utf8');

    expect(migration).toContain(
      'ALTER TABLE "jobs" ADD COLUMN "trailing_payload" jsonb;',
    );
    expect(migration).toContain(
      'ALTER TABLE "jobs" ADD COLUMN "trailing_max_attempts" integer;',
    );
    expect(migration).not.toMatch(
      /\b(?:DROP TABLE|DROP COLUMN|TRUNCATE|DELETE|UPDATE)\b/i,
    );
  });
});
