import {
  checkHttp,
  type HealthResult,
} from '@deployhub/collectors';
import {
  enqueueUnique,
  recordChangeIfChanged,
  schema,
  type Db,
} from '@deployhub/db';
import { eq, isNull } from 'drizzle-orm';
import type { JobHandler } from '../runner';

// Ten seconds avoids false alerts from Caddy-fronted Next.js cold starts that
// can exceed five seconds. At four concurrent checks this allows 120 targets
// within runner.ts's 300-second lease; revisit the lease with either constant.
const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 10_000;
const MAX_CONCURRENT_CHECKS = 4;
export const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1_000;

type HealthTarget = {
  projectId: string;
  componentId: string | null;
  resourceId: null;
};

type HealthCheck = {
  url: string;
  target: HealthTarget;
};

type HealthTargetCandidate = {
  source: 'domain' | 'component';
  target: HealthTarget;
};

type HealthCheckDependencies = {
  checkHttp?: typeof checkHttp;
};

function eventValue(result: HealthResult): {
  currentValue: string;
  severity: 'info' | 'warning' | 'critical';
} {
  if (result.kind === 'up') {
    return { currentValue: 'up', severity: 'info' };
  }
  if (result.kind === 'down') {
    return {
      currentValue: `down (${result.status})`,
      severity: 'critical',
    };
  }
  return {
    currentValue: `unreachable (${result.reason})`,
    severity: 'warning',
  };
}

async function healthTargets(db: Db): Promise<HealthCheck[]> {
  const [domains, components] = await Promise.all([
    db
      .select({
        projectId: schema.domains.projectId,
        componentId: schema.domains.componentId,
        domain: schema.domains.domain,
      })
      .from(schema.domains)
      .innerJoin(
        schema.projects,
        eq(schema.domains.projectId, schema.projects.id),
      )
      .where(isNull(schema.projects.archivedAt)),
    db
      .select({
        projectId: schema.components.projectId,
        componentId: schema.components.id,
        url: schema.components.url,
      })
      .from(schema.components)
      .innerJoin(
        schema.projects,
        eq(schema.components.projectId, schema.projects.id),
      )
      .where(isNull(schema.projects.archivedAt)),
  ]);
  const targetsByUrl = new Map<string, HealthTargetCandidate>();

  function addTarget(
    url: string,
    source: HealthTargetCandidate['source'],
    target: HealthTarget,
  ): void {
    const current = targetsByUrl.get(url);
    const candidateIsMoreSpecific = target.componentId !== null
      && current?.target.componentId === null;
    const candidateIsDomainTieBreaker = target.componentId !== null
      && current !== undefined
      && current.target.componentId !== null
      && source === 'domain'
      && current.source === 'component';

    if (
      current === undefined
      || candidateIsMoreSpecific
      || candidateIsDomainTieBreaker
    ) {
      targetsByUrl.set(url, { source, target });
    }
  }

  for (const domain of domains) {
    const url = `https://${domain.domain}`;
    addTarget(url, 'domain', {
      projectId: domain.projectId,
      componentId: domain.componentId,
      resourceId: null,
    });
  }
  for (const component of components) {
    if (component.url !== null) {
      addTarget(component.url, 'component', {
        projectId: component.projectId,
        componentId: component.componentId,
        resourceId: null,
      });
    }
  }

  return [...targetsByUrl].map(([url, candidate]) => ({
    url,
    target: candidate.target,
  }));
}

export function createHealthCheckHandler(
  db: Db,
  timeoutMs: number = DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
  dependencies: HealthCheckDependencies = {},
): JobHandler {
  const check = dependencies.checkHttp ?? checkHttp;

  return async () => {
    const targets = await healthTargets(db);

    for (
      let offset = 0;
      offset < targets.length;
      offset += MAX_CONCURRENT_CHECKS
    ) {
      const batch = targets.slice(offset, offset + MAX_CONCURRENT_CHECKS);
      await Promise.all(batch.map(async (healthCheck) => {
        const result = await check(healthCheck.url, timeoutMs);
        const value = eventValue(result);
        await recordChangeIfChanged(db, {
          projectId: healthCheck.target.projectId,
          componentId: healthCheck.target.componentId,
          resourceId: healthCheck.target.resourceId,
          kind: 'health_status',
          severity: value.severity,
          currentValue: value.currentValue,
          detail: `Health check for ${healthCheck.url}`,
        });
      }));
    }
  };
}

export async function enqueueHealthCheckJob(db: Db): Promise<void> {
  await enqueueUnique(db, {
    type: 'health.check',
    payload: {},
  });
}
