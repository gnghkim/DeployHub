import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { startTestDb } from '@deployhub/db/test/helpers/pg.js';
import {
  schema,
  type Db,
  type JobRecord,
} from '@deployhub/db';
import type { HealthResult } from '@deployhub/collectors';
import {
  createHealthCheckHandler,
  enqueueHealthCheckJob,
  HEALTH_CHECK_INTERVAL_MS,
} from './health-check';

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
  await db.delete(schema.domains);
  await db.delete(schema.components);
  await db.delete(schema.projects);
  await db.delete(schema.jobs);
});

function job(): JobRecord {
  return {
    id: 'health-job-id',
    type: 'health.check',
    payload: {},
    attempts: 1,
    maxAttempts: 3,
  };
}

async function insertProject(
  slug: string,
  archivedAt: Date | null = null,
): Promise<string> {
  const [project] = await db.insert(schema.projects).values({
    name: slug,
    slug,
    archivedAt,
  }).returning({ id: schema.projects.id });
  return project!.id;
}

async function insertComponent(
  projectId: string,
  slug: string,
  url: string | null,
): Promise<string> {
  const [component] = await db.insert(schema.components).values({
    projectId,
    name: slug,
    slug,
    componentType: 'frontend',
    url,
  }).returning({ id: schema.components.id });
  return component!.id;
}

describe('HTTP health check handler', () => {
  it('runs on a five-minute interval', () => {
    expect(HEALTH_CHECK_INTERVAL_MS).toBe(5 * 60 * 1_000);
  });

  it('succeeds without checking or recording when there are no targets', async () => {
    const checkHttp = vi.fn();

    await createHealthCheckHandler(db, 1_234, { checkHttp })(job());

    expect(checkHttp).not.toHaveBeenCalled();
    expect(await db.select().from(schema.changeEvents)).toEqual([]);
  });

  it('does not check domains owned by archived projects', async () => {
    const archivedProjectId = await insertProject(
      'archived-domain-project',
      new Date(),
    );
    const activeProjectId = await insertProject('active-domain-project');
    await db.insert(schema.domains).values([
      {
        projectId: archivedProjectId,
        componentId: null,
        domain: 'archived-domain.example.com',
        environment: 'production',
      },
      {
        projectId: activeProjectId,
        componentId: null,
        domain: 'active-domain.example.com',
        environment: 'production',
      },
    ]);
    const checkHttp = vi.fn().mockResolvedValue({
      kind: 'up',
      status: 200,
      latencyMs: 1,
    } satisfies HealthResult);

    await createHealthCheckHandler(db, 1_234, { checkHttp })(job());

    expect(checkHttp).toHaveBeenCalledOnce();
    expect(checkHttp).toHaveBeenCalledWith(
      'https://active-domain.example.com',
      1_234,
    );
  });

  it('does not check component URLs owned by archived projects', async () => {
    const archivedProjectId = await insertProject(
      'archived-component-project',
      new Date(),
    );
    const activeProjectId = await insertProject('active-component-project');
    await insertComponent(
      archivedProjectId,
      'archived-component',
      'https://archived-component.example.com',
    );
    await insertComponent(
      activeProjectId,
      'active-component',
      'https://active-component.example.com',
    );
    const checkHttp = vi.fn().mockResolvedValue({
      kind: 'up',
      status: 200,
      latencyMs: 1,
    } satisfies HealthResult);

    await createHealthCheckHandler(db, 1_234, { checkHttp })(job());

    expect(checkHttp).toHaveBeenCalledOnce();
    expect(checkHttp).toHaveBeenCalledWith(
      'https://active-component.example.com',
      1_234,
    );
  });

  it('checks a project again after it is unarchived', async () => {
    const projectId = await insertProject(
      'restored-project',
      new Date(),
    );
    await insertComponent(
      projectId,
      'restored-component',
      'https://restored.example.com',
    );
    const checkHttp = vi.fn().mockResolvedValue({
      kind: 'up',
      status: 200,
      latencyMs: 1,
    } satisfies HealthResult);
    const handler = createHealthCheckHandler(db, 1_234, { checkHttp });

    await handler(job());
    expect(checkHttp).not.toHaveBeenCalled();

    await db
      .update(schema.projects)
      .set({ archivedAt: null })
      .where(eq(schema.projects.id, projectId));
    await handler(job());

    expect(checkHttp).toHaveBeenCalledOnce();
    expect(checkHttp).toHaveBeenCalledWith(
      'https://restored.example.com',
      1_234,
    );
  });

  it('succeeds with zero requests when only archived projects have targets', async () => {
    const projectId = await insertProject(
      'archived-only-project',
      new Date(),
    );
    await insertComponent(
      projectId,
      'archived-only-component',
      'https://archived-only-component.example.com',
    );
    await db.insert(schema.domains).values({
      projectId,
      componentId: null,
      domain: 'archived-only-domain.example.com',
      environment: 'production',
    });
    const checkHttp = vi.fn().mockResolvedValue({
      kind: 'up',
      status: 200,
      latencyMs: 1,
    } satisfies HealthResult);

    await expect(
      createHealthCheckHandler(db, 1_234, { checkHttp })(job()),
    ).resolves.toBeUndefined();

    expect(checkHttp).not.toHaveBeenCalled();
    expect(await db.select().from(schema.changeEvents)).toEqual([]);
  });

  it('records one component-scoped event when a project domain and component share a URL', async () => {
    const projectId = await insertProject('duplicate-project');
    const componentId = await insertComponent(
      projectId,
      'duplicate-component',
      'https://example.com',
    );
    await db.insert(schema.domains).values({
      projectId,
      componentId: null,
      domain: 'example.com',
      environment: 'production',
    });
    const checkHttp = vi.fn().mockResolvedValue({
      kind: 'up',
      status: 204,
      latencyMs: 7,
    } satisfies HealthResult);

    await createHealthCheckHandler(db, 1_234, { checkHttp })(job());

    expect(checkHttp).toHaveBeenCalledOnce();
    expect(checkHttp).toHaveBeenCalledWith(
      'https://example.com',
      1_234,
    );
    expect(
      await db
        .select({
          projectId: schema.changeEvents.projectId,
          componentId: schema.changeEvents.componentId,
          resourceId: schema.changeEvents.resourceId,
          kind: schema.changeEvents.kind,
          severity: schema.changeEvents.severity,
          currentValue: schema.changeEvents.currentValue,
        })
        .from(schema.changeEvents),
    ).toEqual([
      {
        projectId,
        componentId,
        resourceId: null,
        kind: 'health_status',
        severity: 'info',
        currentValue: 'up',
      },
    ]);
  });

  it('records one event when a component domain and its URL are identical', async () => {
    const projectId = await insertProject('linked-domain-project');
    const componentId = await insertComponent(
      projectId,
      'linked-domain-component',
      'https://linked.example.com',
    );
    await db.insert(schema.domains).values({
      projectId,
      componentId,
      domain: 'linked.example.com',
      environment: 'production',
    });
    const checkHttp = vi.fn().mockResolvedValue({
      kind: 'up',
      status: 200,
      latencyMs: 2,
    } satisfies HealthResult);

    await createHealthCheckHandler(db, 1_234, { checkHttp })(job());

    expect(checkHttp).toHaveBeenCalledOnce();
    expect(await db.select().from(schema.changeEvents)).toMatchObject([
      {
        projectId,
        componentId,
        resourceId: null,
      },
    ]);
  });

  it('prefers a domain-linked component over another component with the same URL', async () => {
    const projectId = await insertProject('domain-priority-project');
    const domainComponentId = await insertComponent(
      projectId,
      'domain-component',
      null,
    );
    await insertComponent(
      projectId,
      'url-component',
      'https://priority.example.com',
    );
    await db.insert(schema.domains).values({
      projectId,
      componentId: domainComponentId,
      domain: 'priority.example.com',
      environment: 'production',
    });
    const checkHttp = vi.fn().mockResolvedValue({
      kind: 'up',
      status: 200,
      latencyMs: 2,
    } satisfies HealthResult);

    await createHealthCheckHandler(db, 1_234, { checkHttp })(job());

    expect(checkHttp).toHaveBeenCalledOnce();
    expect(await db.select().from(schema.changeEvents)).toMatchObject([
      {
        projectId,
        componentId: domainComponentId,
        resourceId: null,
      },
    ]);
  });

  it('checks different URLs separately', async () => {
    const projectId = await insertProject('different-url-project');
    await insertComponent(
      projectId,
      'first-component',
      'https://first.example.com',
    );
    await db.insert(schema.domains).values({
      projectId,
      componentId: null,
      domain: 'second.example.com',
      environment: 'production',
    });
    const checkHttp = vi.fn().mockResolvedValue({
      kind: 'up',
      status: 200,
      latencyMs: 2,
    } satisfies HealthResult);

    await createHealthCheckHandler(db, 1_234, { checkHttp })(job());

    expect(checkHttp).toHaveBeenCalledTimes(2);
    expect(checkHttp).toHaveBeenCalledWith(
      'https://first.example.com',
      1_234,
    );
    expect(checkHttp).toHaveBeenCalledWith(
      'https://second.example.com',
      1_234,
    );
  });

  it('uses the ten-second default timeout', async () => {
    const projectId = await insertProject('default-timeout-project');
    await insertComponent(
      projectId,
      'default-timeout-component',
      'https://default-timeout.example.com',
    );
    const checkHttp = vi.fn().mockResolvedValue({
      kind: 'up',
      status: 200,
      latencyMs: 1,
    } satisfies HealthResult);

    await createHealthCheckHandler(
      db,
      undefined,
      { checkHttp },
    )(job());

    expect(checkHttp).toHaveBeenCalledWith(
      'https://default-timeout.example.com',
      10_000,
    );
  });

  it('limits health requests to four at a time', async () => {
    const projectId = await insertProject('concurrency-project');
    for (let index = 0; index < 9; index += 1) {
      await insertComponent(
        projectId,
        `component-${index}`,
        `https://component-${index}.example.com`,
      );
    }
    let active = 0;
    let maximumActive = 0;
    const checkHttp = vi.fn(async (): Promise<HealthResult> => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      active -= 1;
      return { kind: 'up', status: 200, latencyMs: 1 };
    });

    await createHealthCheckHandler(db, 1_234, { checkHttp })(job());

    expect(checkHttp).toHaveBeenCalledTimes(9);
    expect(maximumActive).toBe(4);
  });

  it('maps up, down, and unreachable results to their severities', async () => {
    const projectId = await insertProject('severity-project');
    await insertComponent(
      projectId,
      'up',
      'https://up.example.com',
    );
    await insertComponent(
      projectId,
      'down',
      'https://down.example.com',
    );
    await insertComponent(
      projectId,
      'timeout',
      'https://timeout.example.com',
    );
    const checkHttp = vi.fn(
      async (url: string): Promise<HealthResult> => {
        if (url.includes('up.')) {
          return { kind: 'up', status: 200, latencyMs: 3 };
        }
        if (url.includes('down.')) {
          return { kind: 'down', status: 500, latencyMs: 4 };
        }
        return {
          kind: 'unreachable',
          reason: 'timeout',
          latencyMs: 5,
        };
      },
    );

    await createHealthCheckHandler(db, 1_234, { checkHttp })(job());

    const events = await db
      .select({
        severity: schema.changeEvents.severity,
        currentValue: schema.changeEvents.currentValue,
        detail: schema.changeEvents.detail,
        resourceId: schema.changeEvents.resourceId,
      })
      .from(schema.changeEvents)
      .orderBy(asc(schema.changeEvents.currentValue));
    expect(events).toEqual([
      {
        severity: 'critical',
        currentValue: 'down (500)',
        detail: 'Health check for https://down.example.com',
        resourceId: null,
      },
      {
        severity: 'warning',
        currentValue: 'unreachable (timeout)',
        detail: 'Health check for https://timeout.example.com',
        resourceId: null,
      },
      {
        severity: 'info',
        currentValue: 'up',
        detail: 'Health check for https://up.example.com',
        resourceId: null,
      },
    ]);
    expect(events.every(({ detail }) => !detail.includes('\n'))).toBe(true);
  });

  it('enqueues at most one pending health check job', async () => {
    await enqueueHealthCheckJob(db);
    await enqueueHealthCheckJob(db);

    expect(await db.select().from(schema.jobs)).toMatchObject([
      {
        type: 'health.check',
        payload: {},
        status: 'pending',
      },
    ]);
  });
});
