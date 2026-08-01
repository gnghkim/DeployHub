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
  listProjectStatusData,
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
  healthUrl: string | null = null,
): Promise<string> {
  const [component] = await db.insert(schema.components).values({
    projectId,
    name: slug,
    slug,
    componentType: 'frontend',
    url,
    healthUrl,
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

  it('checks an explicit component health URL without also checking its same-origin domain root', async () => {
    const projectId = await insertProject('yield');
    const componentId = await insertComponent(
      projectId,
      'api',
      'https://api.yield.ktgobiz.co.kr',
      'https://api.yield.ktgobiz.co.kr/health/ready',
    );
    await db.insert(schema.domains).values({
      projectId,
      componentId: null,
      domain: 'api.yield.ktgobiz.co.kr',
      environment: 'production',
    });
    const checkHttp = vi.fn().mockResolvedValue({
      kind: 'up',
      status: 200,
      latencyMs: 2,
    } satisfies HealthResult);

    await createHealthCheckHandler(db, 1_234, { checkHttp })(job());

    expect(checkHttp).toHaveBeenCalledOnce();
    expect(checkHttp).toHaveBeenCalledWith(
      'https://api.yield.ktgobiz.co.kr/health/ready',
      1_234,
    );
    const events = await db.select().from(schema.changeEvents);
    expect(events).toHaveLength(2);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        projectId,
        componentId,
        resourceId: null,
        kind: 'health_status',
        severity: 'info',
        currentValue: 'up',
      }),
      expect.objectContaining({
        projectId,
        componentId: null,
        resourceId: null,
        kind: 'health_status',
        severity: 'info',
        currentValue: 'up',
      }),
    ]));
  });

  it('reconciles prior domain failures through replacement health checks', async () => {
    const projectId = await insertProject('replaced-domain-scopes');
    const projectReplacementId = await insertComponent(
      projectId,
      'project-replacement',
      null,
    );
    const componentReplacementId = await insertComponent(
      projectId,
      'component-replacement',
      'https://component-scope.example.com',
    );
    const priorDomainComponentId = await insertComponent(
      projectId,
      'prior-domain-scope',
      null,
    );
    await db.insert(schema.domains).values([
      {
        projectId,
        componentId: null,
        domain: 'project-scope.example.com',
        environment: 'production',
      },
      {
        projectId,
        componentId: priorDomainComponentId,
        domain: 'component-scope.example.com',
        environment: 'production',
      },
    ]);
    let readinessResult: HealthResult = {
      kind: 'up',
      status: 200,
      latencyMs: 2,
    };
    const checkHttp = vi.fn(async (url: string): Promise<HealthResult> => (
      url.endsWith('/ready')
        ? readinessResult
        : { kind: 'down', status: 404, latencyMs: 2 }
    ));
    const handler = createHealthCheckHandler(db, 1_234, { checkHttp });

    await handler(job());

    expect(checkHttp).toHaveBeenCalledTimes(2);
    expect(checkHttp).toHaveBeenCalledWith(
      'https://project-scope.example.com',
      1_234,
    );
    expect(checkHttp).toHaveBeenCalledWith(
      'https://component-scope.example.com',
      1_234,
    );
    expect(
      (await listProjectStatusData(db, [projectId])).get(projectId)?.status,
    ).toBe('장애');

    await db
      .update(schema.components)
      .set({
        url: 'https://project-scope.example.com',
        healthUrl: 'https://project-scope.example.com/ready',
      })
      .where(eq(schema.components.id, projectReplacementId));
    await db
      .update(schema.components)
      .set({ healthUrl: 'https://component-scope.example.com/ready' })
      .where(eq(schema.components.id, componentReplacementId));
    checkHttp.mockClear();

    await handler(job());

    expect(checkHttp).toHaveBeenCalledTimes(2);
    expect(checkHttp).toHaveBeenCalledWith(
      'https://project-scope.example.com/ready',
      1_234,
    );
    expect(checkHttp).toHaveBeenCalledWith(
      'https://component-scope.example.com/ready',
      1_234,
    );
    expect(checkHttp).not.toHaveBeenCalledWith(
      'https://project-scope.example.com',
      1_234,
    );
    expect(checkHttp).not.toHaveBeenCalledWith(
      'https://component-scope.example.com',
      1_234,
    );

    const status = (await listProjectStatusData(db, [projectId])).get(
      projectId,
    );
    expect(status?.status).toBe('정상');
    expect(status?.latestEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        componentId: null,
        kind: 'health_status',
        severity: 'info',
        currentValue: 'up',
      }),
      expect.objectContaining({
        componentId: priorDomainComponentId,
        kind: 'health_status',
        severity: 'info',
        currentValue: 'up',
      }),
    ]));
    const history = await db.select().from(schema.changeEvents);
    expect(history.filter(({ severity }) => severity === 'critical'))
      .toHaveLength(2);

    readinessResult = { kind: 'down', status: 503, latencyMs: 2 };
    checkHttp.mockClear();

    await handler(job());

    expect(checkHttp).toHaveBeenCalledTimes(2);
    expect(checkHttp).not.toHaveBeenCalledWith(
      'https://project-scope.example.com',
      1_234,
    );
    expect(checkHttp).not.toHaveBeenCalledWith(
      'https://component-scope.example.com',
      1_234,
    );
    const failingStatus = (
      await listProjectStatusData(db, [projectId])
    ).get(projectId);
    expect(failingStatus?.status).toBe('장애');
    expect(failingStatus?.latestEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        componentId: null,
        kind: 'health_status',
        severity: 'critical',
        currentValue: 'down (503)',
      }),
      expect.objectContaining({
        componentId: priorDomainComponentId,
        kind: 'health_status',
        severity: 'critical',
        currentValue: 'down (503)',
      }),
    ]));
  });

  it('checks the component URL when no explicit health URL is configured', async () => {
    const projectId = await insertProject('legacy-health-project');
    await insertComponent(
      projectId,
      'legacy-health-component',
      'https://legacy-health.example.com',
    );
    const checkHttp = vi.fn().mockResolvedValue({
      kind: 'up',
      status: 200,
      latencyMs: 2,
    } satisfies HealthResult);

    await createHealthCheckHandler(db, 1_234, { checkHttp })(job());

    expect(checkHttp).toHaveBeenCalledOnce();
    expect(checkHttp).toHaveBeenCalledWith(
      'https://legacy-health.example.com',
      1_234,
    );
  });

  it('suppresses a component URL origin when its explicit health URL uses another origin', async () => {
    const projectId = await insertProject('cross-origin-health-project');
    await insertComponent(
      projectId,
      'cross-origin-health-component',
      'https://api.example.com',
      'https://status.example.net/api/ready',
    );
    await db.insert(schema.domains).values([
      {
        projectId,
        componentId: null,
        domain: 'api.example.com',
        environment: 'production',
      },
      {
        projectId,
        componentId: null,
        domain: 'www.example.com',
        environment: 'production',
      },
    ]);
    const checkHttp = vi.fn().mockResolvedValue({
      kind: 'up',
      status: 200,
      latencyMs: 2,
    } satisfies HealthResult);

    await createHealthCheckHandler(db, 1_234, { checkHttp })(job());

    expect(checkHttp).toHaveBeenCalledTimes(2);
    expect(checkHttp).toHaveBeenCalledWith(
      'https://status.example.net/api/ready',
      1_234,
    );
    expect(checkHttp).toHaveBeenCalledWith(
      'https://www.example.com',
      1_234,
    );
    expect(checkHttp).not.toHaveBeenCalledWith(
      'https://api.example.com',
      1_234,
    );
  });

  it('does not let one project suppress another project domain', async () => {
    const componentProjectId = await insertProject(
      'component-origin-project',
    );
    const domainProjectId = await insertProject('domain-origin-project');
    await insertComponent(
      componentProjectId,
      'component-origin',
      'https://shared-origin.example.com',
      'https://health.example.net/ready',
    );
    await db.insert(schema.domains).values({
      projectId: domainProjectId,
      componentId: null,
      domain: 'shared-origin.example.com',
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
      'https://health.example.net/ready',
      1_234,
    );
    expect(checkHttp).toHaveBeenCalledWith(
      'https://shared-origin.example.com',
      1_234,
    );
    const events = await db
      .select({ projectId: schema.changeEvents.projectId })
      .from(schema.changeEvents);
    expect(events.map(({ projectId }) => projectId).sort()).toEqual(
      [componentProjectId, domainProjectId].sort(),
    );
  });

  it('retains targets for two projects sharing an explicit health URL', async () => {
    const firstProjectId = await insertProject('first-shared-health-project');
    const secondProjectId = await insertProject(
      'second-shared-health-project',
    );
    await insertComponent(
      firstProjectId,
      'first-shared-health-component',
      'https://first-api.example.com',
      'https://shared-health.example.net/ready',
    );
    await insertComponent(
      secondProjectId,
      'second-shared-health-component',
      'https://second-api.example.com',
      'https://shared-health.example.net/ready',
    );
    const checkHttp = vi.fn().mockResolvedValue({
      kind: 'up',
      status: 200,
      latencyMs: 2,
    } satisfies HealthResult);

    await createHealthCheckHandler(db, 1_234, { checkHttp })(job());

    expect(checkHttp).toHaveBeenCalledTimes(2);
    expect(checkHttp).toHaveBeenNthCalledWith(
      1,
      'https://shared-health.example.net/ready',
      1_234,
    );
    expect(checkHttp).toHaveBeenNthCalledWith(
      2,
      'https://shared-health.example.net/ready',
      1_234,
    );
    const events = await db
      .select({ projectId: schema.changeEvents.projectId })
      .from(schema.changeEvents);
    expect(events.map(({ projectId }) => projectId).sort()).toEqual(
      [firstProjectId, secondProjectId].sort(),
    );
  });

  it('continues checking malformed stored targets and valid targets', async () => {
    const projectId = await insertProject('malformed-target-project');
    await insertComponent(
      projectId,
      'malformed-origin-with-health',
      'not a valid URL',
      'https://malformed-origin-health.example.com/ready',
    );
    await insertComponent(
      projectId,
      'malformed-url-target',
      'also not a valid URL',
    );
    await insertComponent(
      projectId,
      'valid-target',
      'https://valid-target.example.com',
    );
    await db.insert(schema.domains).values({
      projectId,
      componentId: null,
      domain: '%',
      environment: 'production',
    });
    const checkHttp = vi.fn(async (url: string): Promise<HealthResult> => {
      if (url === 'https://%' || url === 'also not a valid URL') {
        return {
          kind: 'unreachable',
          reason: 'network',
          latencyMs: 1,
        };
      }
      return { kind: 'up', status: 200, latencyMs: 2 };
    });

    await expect(
      createHealthCheckHandler(db, 1_234, { checkHttp })(job()),
    ).resolves.toBeUndefined();

    expect(checkHttp).toHaveBeenCalledTimes(4);
    expect(checkHttp).toHaveBeenCalledWith('https://%', 1_234);
    expect(checkHttp).toHaveBeenCalledWith('also not a valid URL', 1_234);
    expect(checkHttp).toHaveBeenCalledWith(
      'https://malformed-origin-health.example.com/ready',
      1_234,
    );
    expect(checkHttp).toHaveBeenCalledWith(
      'https://valid-target.example.com',
      1_234,
    );
    const events = await db
      .select({ currentValue: schema.changeEvents.currentValue })
      .from(schema.changeEvents);
    expect(events.map(({ currentValue }) => currentValue).sort()).toEqual([
      'unreachable (network)',
      'unreachable (network)',
      'up',
      'up',
    ]);
  });

  it('normalizes default ports but keeps non-default ports distinct', async () => {
    const projectId = await insertProject('port-normalization-project');
    await insertComponent(
      projectId,
      'default-port-component',
      'https://default-port.example.com:443',
      'https://health.example.net/default-port',
    );
    await insertComponent(
      projectId,
      'non-default-port-component',
      'https://non-default-port.example.com:8443',
      'https://health.example.net/non-default-port',
    );
    await db.insert(schema.domains).values([
      {
        projectId,
        componentId: null,
        domain: 'default-port.example.com',
        environment: 'production',
      },
      {
        projectId,
        componentId: null,
        domain: 'non-default-port.example.com',
        environment: 'production',
      },
    ]);
    const checkHttp = vi.fn().mockResolvedValue({
      kind: 'up',
      status: 200,
      latencyMs: 2,
    } satisfies HealthResult);

    await createHealthCheckHandler(db, 1_234, { checkHttp })(job());

    expect(checkHttp).toHaveBeenCalledTimes(3);
    expect(checkHttp).not.toHaveBeenCalledWith(
      'https://default-port.example.com',
      1_234,
    );
    expect(checkHttp).toHaveBeenCalledWith(
      'https://non-default-port.example.com',
      1_234,
    );
  });

  it('checks a health URL and domain root when the component URL is null', async () => {
    const projectId = await insertProject('health-only-component-project');
    await insertComponent(
      projectId,
      'health-only-component',
      null,
      'https://health-only.example.com/ready',
    );
    await db.insert(schema.domains).values({
      projectId,
      componentId: null,
      domain: 'health-only.example.com',
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
      'https://health-only.example.com/ready',
      1_234,
    );
    expect(checkHttp).toHaveBeenCalledWith(
      'https://health-only.example.com',
      1_234,
    );
  });

  it('does not let an archived project component suppress an active project domain', async () => {
    const archivedProjectId = await insertProject(
      'archived-suppressor-project',
      new Date(),
    );
    const activeProjectId = await insertProject('active-domain-project');
    await insertComponent(
      archivedProjectId,
      'archived-suppressor',
      'https://active-shared.example.com',
      'https://archived-health.example.net/ready',
    );
    await db.insert(schema.domains).values({
      projectId: activeProjectId,
      componentId: null,
      domain: 'active-shared.example.com',
      environment: 'production',
    });
    const checkHttp = vi.fn().mockResolvedValue({
      kind: 'up',
      status: 200,
      latencyMs: 2,
    } satisfies HealthResult);

    await createHealthCheckHandler(db, 1_234, { checkHttp })(job());

    expect(checkHttp).toHaveBeenCalledOnce();
    expect(checkHttp).toHaveBeenCalledWith(
      'https://active-shared.example.com',
      1_234,
    );
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
