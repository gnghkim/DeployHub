import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { changeEventKind, eventSeverity } from './enums';
import { components, projects } from './projects';
import { resources } from './resources';

export const changeEvents = pgTable(
  'change_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    componentId: uuid('component_id').references(() => components.id, { onDelete: 'cascade' }),
    resourceId: uuid('resource_id').references(() => resources.id, { onDelete: 'cascade' }),
    kind: changeEventKind('kind').notNull(),
    severity: eventSeverity('severity').notNull(),
    previousValue: text('previous_value'),
    currentValue: text('current_value').notNull(),
    detail: text('detail').notNull(),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('change_events_occurred_idx').on(t.occurredAt),
    index('change_events_project_occurred_idx').on(t.projectId, t.occurredAt),
    index('change_events_unnotified_idx').on(t.notifiedAt, t.severity),
  ],
);
