import {
  boolean, index, jsonb, pgTable, text, timestamp, unique, uuid,
} from 'drizzle-orm/pg-core';
import { linkedBy, providerType, relationType, resourceType } from './enums';
import { components } from './projects';

export const providerAccounts = pgTable(
  'provider_accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: providerType('provider').notNull(),
    name: text('name').notNull(),
    externalAccountId: text('external_account_id'),
    encryptedToken: text('encrypted_token').notNull(),
    scopes: jsonb('scopes').notNull().default([]),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('provider_accounts_provider_name_unique').on(t.provider, t.name)],
);

export const resources = pgTable(
  'resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: providerType('provider').notNull(),
    providerAccountId: uuid('provider_account_id').references(
      () => providerAccounts.id,
      { onDelete: 'set null' },
    ),
    externalId: text('external_id').notNull(),
    resourceType: resourceType('resource_type').notNull(),
    name: text('name').notNull(),
    status: text('status'),
    region: text('region'),
    url: text('url'),
    metadata: jsonb('metadata').notNull().default({}),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    unique('resources_provider_external_unique').on(t.provider, t.externalId),
    index('resources_type_idx').on(t.resourceType),
  ],
);

export const componentResources = pgTable(
  'component_resources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    componentId: uuid('component_id')
      .notNull()
      .references(() => components.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id')
      .notNull()
      .references(() => resources.id, { onDelete: 'cascade' }),
    environment: text('environment').notNull().default('production'),
    relationType: relationType('relation_type').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    linkedBy: linkedBy('linked_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('component_resources_unique').on(t.componentId, t.resourceId, t.environment),
  ],
);
