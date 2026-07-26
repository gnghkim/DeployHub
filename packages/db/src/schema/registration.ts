import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { draftSourceType, draftStatus, submitterType } from './enums';
import { projects } from './projects';
import { users } from './users';

export const registrationTokens = pgTable('registration_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: text('token_hash').notNull().unique(),
  scope: text('scope').notNull(),
  repositoryConstraint: text('repository_constraint'),
  projectSlugConstraint: text('project_slug_constraint'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  maxUses: integer('max_uses').notNull().default(1),
  usedCount: integer('used_count').notNull().default(0),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

export const projectDrafts = pgTable('project_drafts', {
  id: uuid('id').primaryKey().defaultRandom(),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  manifestVersion: text('manifest_version').notNull(),
  manifestYaml: text('manifest_yaml').notNull(),
  fieldSources: jsonb('field_sources').notNull().default({}),
  sourceType: draftSourceType('source_type').notNull(),
  submittedByType: submitterType('submitted_by_type').notNull(),
  submittedById: uuid('submitted_by_id').notNull(),
  status: draftStatus('status').notNull().default('draft'),
  validationResult: jsonb('validation_result'),
  diff: jsonb('diff'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
