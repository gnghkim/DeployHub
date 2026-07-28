import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { startTestDb } from '../../test/helpers/pg';
import {
  listTimelineEvents,
  schema,
  type Db,
} from '../index';

let db: Db;
let stop: () => Promise<void>;

beforeAll(async () => {
  const started = await startTestDb();
  db = started.db;
  stop = started.stop;
}, 120_000);

afterAll(async () => {
  await stop();
});

beforeEach(async () => {
  await db.delete(schema.changeEvents);
  await db.delete(schema.resources);
  await db.delete(schema.projects);
});

async function seedProject(slug: string, archived = false) {
  const [project] = await db
    .insert(schema.projects)
    .values({
      name: slug,
      slug,
      archivedAt: archived ? new Date() : null,
    })
    .returning();
  if (!project) throw new Error('project insert failed');
  return project;
}

type EventSeed = {
  projectId?: string | null;
  resourceId?: string | null;
  kind?: typeof schema.changeEvents.$inferInsert.kind;
  severity?: typeof schema.changeEvents.$inferInsert.severity;
  currentValue: string;
  occurredAt?: Date;
};

async function seedEvents(events: EventSeed[]) {
  return db
    .insert(schema.changeEvents)
    .values(events.map((event) => ({
      projectId: event.projectId ?? null,
      componentId: null,
      resourceId: event.resourceId ?? null,
      kind: event.kind ?? 'container_status',
      severity: event.severity ?? 'info',
      previousValue: null,
      currentValue: event.currentValue,
      detail: `detail:${event.currentValue}`,
      occurredAt: event.occurredAt,
    })))
    .returning();
}

describe('listTimelineEvents', () => {
  it('defaults to 100 rows and caps an oversized requested limit at 200', async () => {
    await seedEvents(Array.from({ length: 205 }, (_, index) => ({
      currentValue: `value-${index}`,
    })));

    const defaultPage = await listTimelineEvents(db, {
      projectId: null,
    });
    const oversizedPage = await listTimelineEvents(db, {
      projectId: null,
      limit: 10_000,
    });

    expect(defaultPage.events).toHaveLength(100);
    expect(defaultPage.nextCursor).toBe(
      defaultPage.events.at(-1)?.seq,
    );
    expect(oversizedPage.events).toHaveLength(200);
    expect(oversizedPage.nextCursor).toBe(
      oversizedPage.events.at(-1)?.seq,
    );
  });

  it('paginates only by descending seq without omissions or overlap', async () => {
    const occurredAt = new Date('2026-07-28T00:00:00.000Z');
    const inserted = await seedEvents(
      Array.from({ length: 7 }, (_, index) => ({
        currentValue: `value-${index}`,
        occurredAt,
      })),
    );

    const collected = [];
    let cursor: bigint | undefined;
    do {
      const page = await listTimelineEvents(db, {
        projectId: null,
        cursor,
        limit: 3,
      });
      collected.push(...page.events);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);

    const expected = inserted
      .map((event) => event.seq)
      .sort((left, right) => left > right ? -1 : 1);
    expect(collected.map((event) => event.seq)).toEqual(expected);
    expect(new Set(collected.map((event) => event.seq)).size).toBe(7);
    expect(new Set(collected.map(
      (event) => event.occurredAt.toISOString(),
    ))).toEqual(new Set([occurredAt.toISOString()]));
  });

  it('applies excluded event IDs before the page limit', async () => {
    const inserted = await seedEvents(
      Array.from({ length: 21 }, (_, index) => ({
        currentValue: `history-${index}`,
      })),
    );
    const newestTwentyIds = inserted
      .slice(1)
      .map((event) => event.id);

    const page = await listTimelineEvents(db, {
      projectId: null,
      excludeIds: newestTwentyIds,
      limit: 1,
    });

    expect(page.events).toHaveLength(1);
    expect(page.events[0]?.id).toBe(inserted[0]?.id);
    expect(page.events[0]?.currentValue).toBe('history-0');
  });

  it('returns every project and global event globally, but only one project when scoped', async () => {
    const active = await seedProject('active');
    const archived = await seedProject('archived', true);
    const [deletedResource] = await db
      .insert(schema.resources)
      .values({
        provider: 'docker',
        externalId: 'deleted-resource',
        resourceType: 'docker_container',
        name: 'deleted-resource',
        deletedAt: new Date(),
      })
      .returning();
    if (!deletedResource) throw new Error('resource insert failed');

    await seedEvents([
      {
        projectId: active.id,
        resourceId: deletedResource.id,
        currentValue: 'active-deleted-resource',
      },
      { projectId: archived.id, currentValue: 'archived' },
      { projectId: null, currentValue: 'global' },
    ]);

    const globalPage = await listTimelineEvents(db, {
      projectId: null,
    });
    const projectPage = await listTimelineEvents(db, {
      projectId: active.id,
    });

    expect(globalPage.events.map((event) => event.currentValue))
      .toEqual(['global', 'archived', 'active-deleted-resource']);
    expect(projectPage.events).toHaveLength(1);
    expect(projectPage.events[0]).toMatchObject({
      projectId: active.id,
      resourceId: deletedResource.id,
      currentValue: 'active-deleted-resource',
    });
  });

  it('filters by kind and severity independently and together', async () => {
    await seedEvents([
      {
        kind: 'container_status',
        severity: 'info',
        currentValue: 'status-info',
      },
      {
        kind: 'container_status',
        severity: 'critical',
        currentValue: 'status-critical',
      },
      {
        kind: 'ssl_expiry',
        severity: 'warning',
        currentValue: 'ssl-warning',
      },
      {
        kind: 'ssl_expiry',
        severity: 'critical',
        currentValue: 'ssl-critical',
      },
    ]);

    const kind = await listTimelineEvents(db, {
      projectId: null,
      kind: 'ssl_expiry',
    });
    const severity = await listTimelineEvents(db, {
      projectId: null,
      severity: 'critical',
    });
    const both = await listTimelineEvents(db, {
      projectId: null,
      kind: 'container_status',
      severity: 'critical',
    });

    expect(kind.events.map((event) => event.currentValue))
      .toEqual(['ssl-critical', 'ssl-warning']);
    expect(severity.events.map((event) => event.currentValue))
      .toEqual(['ssl-critical', 'status-critical']);
    expect(both.events.map((event) => event.currentValue))
      .toEqual(['status-critical']);
  });
});
