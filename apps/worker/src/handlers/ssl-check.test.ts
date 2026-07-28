import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { asc } from 'drizzle-orm';
import { startTestDb } from '@deployhub/db/test/helpers/pg.js';
import {
  schema,
  type Db,
  type JobRecord,
} from '@deployhub/db';
import type { CertificateResult } from '@deployhub/collectors';
import {
  createSslCheckHandler,
  enqueueSslCheckJob,
  SSL_CHECK_INTERVAL_MS,
} from './ssl-check';

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
    id: 'ssl-job-id',
    type: 'ssl.check',
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
): Promise<string> {
  const [component] = await db.insert(schema.components).values({
    projectId,
    name: slug,
    slug,
    componentType: 'frontend',
  }).returning({ id: schema.components.id });
  return component!.id;
}

function certificate(
  daysRemaining: number,
  overrides: Partial<Extract<CertificateResult, { kind: 'ok' }>> = {},
): Extract<CertificateResult, { kind: 'ok' }> {
  return {
    kind: 'ok',
    validTo: '2030-02-15T00:00:00.000Z',
    issuer: 'Test CA',
    daysRemaining,
    verified: true,
    verificationError: null,
    ...overrides,
  };
}

describe('SSL certificate check handler', () => {
  it('runs on a 24-hour interval', () => {
    expect(SSL_CHECK_INTERVAL_MS).toBe(24 * 60 * 60 * 1_000);
  });

  it('succeeds quietly when there are no domains', async () => {
    const fetchCertificate = vi.fn();

    await expect(createSslCheckHandler(
      db,
      1_234,
      { fetchCertificate },
    )(job())).resolves.toBeUndefined();

    expect(fetchCertificate).not.toHaveBeenCalled();
    expect(await db.select().from(schema.changeEvents)).toEqual([]);
  });

  it('checks a shared hostname once, updates every row, and records one component-scoped event', async () => {
    const projectId = await insertProject('shared-host-project');
    const componentId = await insertComponent(
      projectId,
      'shared-host-component',
    );
    await db.insert(schema.domains).values([
      {
        projectId,
        componentId: null,
        domain: 'shared.example.com',
        environment: 'preview',
      },
      {
        projectId,
        componentId,
        domain: 'shared.example.com',
        environment: 'production',
      },
    ]);
    const fetchCertificate = vi.fn().mockResolvedValue(
      certificate(45),
    );

    await createSslCheckHandler(
      db,
      1_234,
      { fetchCertificate },
    )(job());

    expect(fetchCertificate).toHaveBeenCalledOnce();
    expect(fetchCertificate).toHaveBeenCalledWith(
      'shared.example.com',
      1_234,
    );
    const domains = await db
      .select({
        sslExpiresAt: schema.domains.sslExpiresAt,
        lastCheckedAt: schema.domains.lastCheckedAt,
      })
      .from(schema.domains);
    expect(domains).toHaveLength(2);
    expect(domains.every(
      ({ sslExpiresAt }) => sslExpiresAt?.toISOString()
        === '2030-02-15T00:00:00.000Z',
    )).toBe(true);
    expect(domains.every(({ lastCheckedAt }) => lastCheckedAt !== null))
      .toBe(true);
    expect(await db.select().from(schema.changeEvents)).toMatchObject([
      {
        projectId,
        componentId,
        resourceId: null,
        kind: 'ssl_expiry',
        severity: 'info',
        currentValue: '2030-02-15 (45d)',
      },
    ]);
  });

  it('groups case and trailing-dot variants as one DNS hostname', async () => {
    const projectId = await insertProject('canonical-host-project');
    await db.insert(schema.domains).values([
      {
        projectId,
        domain: 'Example.COM.',
        environment: 'preview',
      },
      {
        projectId,
        domain: 'example.com',
        environment: 'production',
      },
    ]);
    const fetchCertificate = vi.fn().mockResolvedValue(
      certificate(45),
    );

    await createSslCheckHandler(
      db,
      1_234,
      { fetchCertificate },
    )(job());

    expect(fetchCertificate).toHaveBeenCalledOnce();
    expect(fetchCertificate).toHaveBeenCalledWith('example.com', 1_234);
    const domains = await db
      .select({
        domain: schema.domains.domain,
        sslExpiresAt: schema.domains.sslExpiresAt,
        lastCheckedAt: schema.domains.lastCheckedAt,
      })
      .from(schema.domains)
      .orderBy(asc(schema.domains.domain));
    expect(domains.map(({ domain }) => domain)).toEqual([
      'Example.COM.',
      'example.com',
    ]);
    expect(domains.every(
      ({ sslExpiresAt }) => sslExpiresAt?.toISOString()
        === '2030-02-15T00:00:00.000Z',
    )).toBe(true);
    expect(domains.every(({ lastCheckedAt }) => lastCheckedAt !== null))
      .toBe(true);
    expect(await db.select().from(schema.changeEvents)).toHaveLength(1);
  });

  it('skips domains owned by archived projects', async () => {
    const archivedProjectId = await insertProject(
      'archived-ssl-project',
      new Date(),
    );
    const activeProjectId = await insertProject('active-ssl-project');
    await db.insert(schema.domains).values([
      {
        projectId: archivedProjectId,
        domain: 'archived.example.com',
        environment: 'production',
      },
      {
        projectId: activeProjectId,
        domain: 'active.example.com',
        environment: 'production',
      },
    ]);
    const fetchCertificate = vi.fn().mockResolvedValue(certificate(60));

    await createSslCheckHandler(
      db,
      1_234,
      { fetchCertificate },
    )(job());

    expect(fetchCertificate).toHaveBeenCalledOnce();
    expect(fetchCertificate).toHaveBeenCalledWith(
      'active.example.com',
      1_234,
    );
    const rows = await db
      .select({
        domain: schema.domains.domain,
        lastCheckedAt: schema.domains.lastCheckedAt,
      })
      .from(schema.domains)
      .orderBy(asc(schema.domains.domain));
    expect(rows).toMatchObject([
      { domain: 'active.example.com' },
      { domain: 'archived.example.com', lastCheckedAt: null },
    ]);
    expect(rows[0]!.lastCheckedAt).not.toBeNull();
  });

  it('updates last_checked_at on failure without changing ssl_expires_at', async () => {
    const projectId = await insertProject('failed-ssl-project');
    const previousExpiry = new Date('2031-06-01T00:00:00.000Z');
    await db.insert(schema.domains).values({
      projectId,
      domain: 'failure.example.com',
      environment: 'production',
      sslExpiresAt: previousExpiry,
    });
    const fetchCertificate = vi.fn().mockResolvedValue({
      kind: 'error',
      reason: 'timeout',
    } satisfies CertificateResult);

    await createSslCheckHandler(
      db,
      1_234,
      { fetchCertificate },
    )(job());

    const [domain] = await db.select().from(schema.domains);
    expect(domain!.lastCheckedAt).not.toBeNull();
    expect(domain!.sslExpiresAt).toEqual(previousExpiry);
    expect(await db.select().from(schema.changeEvents)).toMatchObject([
      {
        projectId,
        componentId: null,
        resourceId: null,
        kind: 'ssl_expiry',
        severity: 'warning',
        currentValue: 'error (timeout)',
      },
    ]);
  });

  it('reports an unverified long-lived certificate as critical', async () => {
    const projectId = await insertProject('unverified-ssl-project');
    await db.insert(schema.domains).values({
      projectId,
      domain: 'unverified.example.com',
      environment: 'production',
    });
    const fetchCertificate = vi.fn().mockResolvedValue(certificate(
      365,
      {
        verified: false,
        verificationError: 'SELF_SIGNED_CERT_IN_CHAIN',
      },
    ));

    await createSslCheckHandler(
      db,
      1_234,
      { fetchCertificate },
    )(job());

    expect(await db.select().from(schema.changeEvents)).toMatchObject([
      {
        severity: 'critical',
        currentValue: 'unverified (SELF_SIGNED_CERT_IN_CHAIN)',
      },
    ]);
  });

  it('treats exactly 7 days as critical and exactly 30 days as warning', async () => {
    const projectId = await insertProject('ssl-boundary-project');
    await db.insert(schema.domains).values([
      {
        projectId,
        domain: 'seven-days.example.com',
        environment: 'production',
      },
      {
        projectId,
        domain: 'thirty-days.example.com',
        environment: 'production',
      },
    ]);
    const fetchCertificate = vi.fn(
      async (host: string): Promise<CertificateResult> => host.startsWith(
          'seven',
        )
        ? certificate(7, { validTo: '2030-01-08T00:00:00.000Z' })
        : certificate(30, { validTo: '2030-01-31T00:00:00.000Z' }),
    );

    await createSslCheckHandler(
      db,
      1_234,
      { fetchCertificate },
    )(job());

    expect(
      await db
        .select({
          severity: schema.changeEvents.severity,
          currentValue: schema.changeEvents.currentValue,
        })
        .from(schema.changeEvents)
        .orderBy(asc(schema.changeEvents.currentValue)),
    ).toEqual([
      {
        severity: 'critical',
        currentValue: '2030-01-08 (7d)',
      },
      {
        severity: 'warning',
        currentValue: '2030-01-31 (30d)',
      },
    ]);
  });

  it('uses the ten-second default timeout', async () => {
    const projectId = await insertProject('default-ssl-timeout-project');
    await db.insert(schema.domains).values({
      projectId,
      domain: 'timeout-default.example.com',
      environment: 'production',
    });
    const fetchCertificate = vi.fn().mockResolvedValue(certificate(45));

    await createSslCheckHandler(
      db,
      undefined,
      { fetchCertificate },
    )(job());

    expect(fetchCertificate).toHaveBeenCalledWith(
      'timeout-default.example.com',
      10_000,
    );
  });

  it('limits TLS handshakes to four at a time', async () => {
    const projectId = await insertProject('ssl-concurrency-project');
    await db.insert(schema.domains).values(
      Array.from({ length: 9 }, (_, index) => ({
        projectId,
        domain: `ssl-${index}.example.com`,
        environment: 'production',
      })),
    );
    let active = 0;
    let maximumActive = 0;
    const fetchCertificate = vi.fn(async (): Promise<CertificateResult> => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      active -= 1;
      return certificate(45);
    });

    await createSslCheckHandler(
      db,
      1_234,
      { fetchCertificate },
    )(job());

    expect(fetchCertificate).toHaveBeenCalledTimes(9);
    expect(maximumActive).toBe(4);
  });

  it('records a repeated hostname value only when it changes', async () => {
    const projectId = await insertProject('unchanged-ssl-project');
    await db.insert(schema.domains).values({
      projectId,
      domain: 'unchanged.example.com',
      environment: 'production',
    });
    const fetchCertificate = vi.fn().mockResolvedValue(certificate(45));
    const handler = createSslCheckHandler(
      db,
      1_234,
      { fetchCertificate },
    );

    await handler(job());
    await handler(job());

    expect(fetchCertificate).toHaveBeenCalledTimes(2);
    expect(await db.select().from(schema.changeEvents)).toHaveLength(1);
  });

  it('enqueues at most one pending SSL check job', async () => {
    await enqueueSslCheckJob(db);
    await enqueueSslCheckJob(db);

    expect(await db.select().from(schema.jobs)).toMatchObject([
      {
        type: 'ssl.check',
        payload: {},
        status: 'pending',
      },
    ]);
  });
});
