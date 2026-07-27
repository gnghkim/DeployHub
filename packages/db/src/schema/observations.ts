import {
  bigint,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { providerType } from './enums';
import { components, projects } from './projects';
import { resources } from './resources';

export const deployments = pgTable(
  'deployments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').references(() => projects.id, {
      onDelete: 'set null',
    }),
    componentId: uuid('component_id').references(() => components.id, {
      onDelete: 'set null',
    }),
    provider: providerType('provider').notNull(),
    environment: text('environment').notNull(),
    version: text('version'),
    commitSha: text('commit_sha'),
    imageName: text('image_name'),
    externalDeploymentId: text('external_deployment_id').notNull(),
    status: text('status').notNull(),
    deploymentUrl: text('deployment_url'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('deployments_provider_external_deployment_unique').on(
      t.provider,
      t.externalDeploymentId,
    ),
  ],
);

export const containerSnapshots = pgTable(
  'container_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    cpuPct: doublePrecision('cpu_pct').notNull(),
    memBytes: bigint('mem_bytes', { mode: 'number' }).notNull(),
    restartCount: integer('restart_count').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('container_snapshots_resource_observed_idx').on(
      t.resourceId,
      t.observedAt,
    ),
  ],
);
