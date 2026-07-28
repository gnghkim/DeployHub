import {
  fetchCertificate,
  type CertificateResult,
} from '@deployhub/collectors';
import {
  enqueueUnique,
  recordChangeIfChanged,
  schema,
  type Db,
} from '@deployhub/db';
import {
  eq,
  inArray,
  isNull,
  sql,
} from 'drizzle-orm';
import type { JobHandler } from '../runner';

const DEFAULT_SSL_CHECK_TIMEOUT_MS = 10_000;
const MAX_CONCURRENT_CHECKS = 4;
export const SSL_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000;

type SslTarget = {
  id: string;
  projectId: string;
  componentId: string | null;
};

type SslCheck = {
  host: string;
  targets: SslTarget[];
};

type SslCheckDependencies = {
  fetchCertificate?: typeof fetchCertificate;
};

function eventValue(result: CertificateResult): {
  currentValue: string;
  severity: 'info' | 'warning' | 'critical';
} {
  if (result.kind === 'error') {
    return {
      currentValue: `error (${result.reason})`,
      severity: 'warning',
    };
  }
  if (!result.verified) {
    return {
      currentValue: `unverified (${result.verificationError})`,
      severity: 'critical',
    };
  }
  return {
    currentValue: `${result.validTo.slice(0, 10)} (${result.daysRemaining}d)`,
    severity: result.daysRemaining <= 7
      ? 'critical'
      : result.daysRemaining <= 30
        ? 'warning'
        : 'info',
  };
}

async function sslTargets(db: Db): Promise<SslCheck[]> {
  const rows = await db
    .select({
      id: schema.domains.id,
      projectId: schema.domains.projectId,
      componentId: schema.domains.componentId,
      host: schema.domains.domain,
    })
    .from(schema.domains)
    .innerJoin(
      schema.projects,
      eq(schema.domains.projectId, schema.projects.id),
    )
    .where(isNull(schema.projects.archivedAt));
  const targetsByHost = new Map<string, SslTarget[]>();

  for (const row of rows) {
    const targets = targetsByHost.get(row.host) ?? [];
    targets.push({
      id: row.id,
      projectId: row.projectId,
      componentId: row.componentId,
    });
    targetsByHost.set(row.host, targets);
  }

  return [...targetsByHost].map(([host, targets]) => ({
    host,
    targets,
  }));
}

export function createSslCheckHandler(
  db: Db,
  timeoutMs: number = DEFAULT_SSL_CHECK_TIMEOUT_MS,
  dependencies: SslCheckDependencies = {},
): JobHandler {
  const check = dependencies.fetchCertificate ?? fetchCertificate;

  return async () => {
    const checks = await sslTargets(db);

    for (
      let offset = 0;
      offset < checks.length;
      offset += MAX_CONCURRENT_CHECKS
    ) {
      const batch = checks.slice(offset, offset + MAX_CONCURRENT_CHECKS);
      await Promise.all(batch.map(async ({ host, targets }) => {
        const result = await check(host, timeoutMs);
        const targetIds = targets.map(({ id }) => id);

        if (result.kind === 'ok') {
          await db
            .update(schema.domains)
            .set({
              sslExpiresAt: new Date(result.validTo),
              lastCheckedAt: sql`clock_timestamp()`,
            })
            .where(inArray(schema.domains.id, targetIds));
        } else {
          await db
            .update(schema.domains)
            .set({ lastCheckedAt: sql`clock_timestamp()` })
            .where(inArray(schema.domains.id, targetIds));
        }

        const eventTarget = targets.find(
          ({ componentId }) => componentId !== null,
        ) ?? targets[0]!;
        const value = eventValue(result);
        await recordChangeIfChanged(db, {
          projectId: eventTarget.projectId,
          componentId: eventTarget.componentId,
          resourceId: null,
          kind: 'ssl_expiry',
          severity: value.severity,
          currentValue: value.currentValue,
          detail: `SSL certificate check for ${host}`,
        });
      }));
    }
  };
}

export async function enqueueSslCheckJob(db: Db): Promise<void> {
  await enqueueUnique(db, {
    type: 'ssl.check',
    payload: {},
  });
}
