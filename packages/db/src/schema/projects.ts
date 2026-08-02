import { relations } from 'drizzle-orm';
import {
  customType, index, integer, jsonb, pgTable, smallint, text, timestamp, unique, uuid,
} from 'drizzle-orm/pg-core';
import {
  componentType,
  projectLifecycle,
  projectStatus,
  snapshotAttemptStatus,
  snapshotMode,
  snapshotSource,
} from './enums';
import { deployments } from './observations';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    description: text('description'),
    status: projectStatus('status').notNull().default('active'),
    lifecycle: projectLifecycle('lifecycle').notNull().default('development'),
    importance: smallint('importance').notNull().default(3),
    owner: text('owner'),
    repository: text('repository'),
    snapshotUrl: text('snapshot_url'),
    snapshotMode: snapshotMode('snapshot_mode').notNull().default('disabled'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    index('projects_repository_idx').on(t.repository),
  ],
);

export const projectSnapshots = pgTable('project_snapshots', {
  projectId: uuid('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  imageData: bytea('image_data'),
  contentType: text('content_type'),
  width: integer('width'),
  height: integer('height'),
  source: snapshotSource('source'),
  sourceUrl: text('source_url'),
  deploymentId: uuid('deployment_id').references(() => deployments.id, {
    onDelete: 'set null',
  }),
  checksum: text('checksum'),
  capturedAt: timestamp('captured_at', { withTimezone: true }),
  lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
  lastAttemptStatus: snapshotAttemptStatus('last_attempt_status'),
  lastError: text('last_error'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const components = pgTable(
  'components',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    componentType: componentType('component_type').notNull(),
    framework: text('framework'),
    runtime: text('runtime'),
    language: text('language'),
    criticality: smallint('criticality').notNull().default(3),
    provider: text('provider'),
    externalRef: text('external_ref'),
    containerName: text('container_name'),
    url: text('url'),
    healthUrl: text('health_url'),
    fieldSources: jsonb('field_sources').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('components_project_slug_unique').on(t.projectId, t.slug),
    index('components_project_idx').on(t.projectId),
    index('components_provider_external_ref_idx').on(t.provider, t.externalRef),
    index('components_container_name_idx').on(t.containerName),
  ],
);

export const domains = pgTable(
  'domains',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    componentId: uuid('component_id').references(() => components.id, {
      onDelete: 'set null',
    }),
    domain: text('domain').notNull(),
    environment: text('environment').notNull(),
    dnsProvider: text('dns_provider'),
    sslExpiresAt: timestamp('ssl_expires_at', { withTimezone: true }),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('domains_project_domain_environment_unique').on(
      t.projectId,
      t.domain,
      t.environment,
    ),
    index('domains_project_idx').on(t.projectId),
  ],
);

export const projectsRelations = relations(projects, ({ many }) => ({
  components: many(components),
  domains: many(domains),
}));

export const componentsRelations = relations(components, ({ one }) => ({
  project: one(projects, {
    fields: [components.projectId],
    references: [projects.id],
  }),
}));

export const domainsRelations = relations(domains, ({ one }) => ({
  project: one(projects, {
    fields: [domains.projectId],
    references: [projects.id],
  }),
  component: one(components, {
    fields: [domains.componentId],
    references: [components.id],
  }),
}));
