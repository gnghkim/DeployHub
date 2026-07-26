import { relations } from 'drizzle-orm';
import {
  index, jsonb, pgTable, smallint, text, timestamp, unique, uuid,
} from 'drizzle-orm/pg-core';
import { componentType, projectLifecycle, projectStatus } from './enums';

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    index('projects_repository_idx').on(t.repository),
  ],
);

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
    fieldSources: jsonb('field_sources').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('components_project_slug_unique').on(t.projectId, t.slug),
    index('components_project_idx').on(t.projectId),
  ],
);

export const projectsRelations = relations(projects, ({ many }) => ({
  components: many(components),
}));

export const componentsRelations = relations(components, ({ one }) => ({
  project: one(projects, {
    fields: [components.projectId],
    references: [projects.id],
  }),
}));
