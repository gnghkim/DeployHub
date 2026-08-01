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
  targets: HealthTarget[];
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

function normalizedOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function healthTargetScopeKey(target: HealthTarget): string {
  return target.componentId !== null
    ? `component:${target.componentId}`
    : `project:${target.projectId}`;
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
        healthUrl: schema.components.healthUrl,
      })
      .from(schema.components)
      .innerJoin(
        schema.projects,
        eq(schema.components.projectId, schema.projects.id),
      )
      .where(isNull(schema.projects.archivedAt)),
  ]);
  const targetsByProjectAndUrl = new Map<
    string,
    Map<string, HealthTargetCandidate>
  >();
  const replacementComponentsByProjectAndOrigin = new Map<
    string,
    Map<string, Map<string, string>>
  >();
  const replacementTargetsByProjectAndUrl = new Map<
    string,
    Map<string, Map<string, HealthTarget>>
  >();

  for (const component of components) {
    if (component.url === null || component.healthUrl === null) {
      continue;
    }
    const origin = normalizedOrigin(component.url);
    if (origin === null) {
      continue;
    }
    const projectOrigins = replacementComponentsByProjectAndOrigin.get(
      component.projectId,
    ) ?? new Map<string, Map<string, string>>();
    const replacementComponents = projectOrigins.get(origin)
      ?? new Map<string, string>();
    replacementComponents.set(component.componentId, component.healthUrl);
    projectOrigins.set(origin, replacementComponents);
    replacementComponentsByProjectAndOrigin.set(
      component.projectId,
      projectOrigins,
    );
  }

  function addTarget(
    url: string,
    source: HealthTargetCandidate['source'],
    target: HealthTarget,
  ): void {
    const targetsByUrl = targetsByProjectAndUrl.get(target.projectId)
      ?? new Map<string, HealthTargetCandidate>();
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
    targetsByProjectAndUrl.set(target.projectId, targetsByUrl);
  }

  function addReplacementTarget(url: string, target: HealthTarget): void {
    const targetsByUrl = replacementTargetsByProjectAndUrl.get(
      target.projectId,
    ) ?? new Map<string, Map<string, HealthTarget>>();
    const targetsByScope = targetsByUrl.get(url)
      ?? new Map<string, HealthTarget>();
    targetsByScope.set(healthTargetScopeKey(target), target);
    targetsByUrl.set(url, targetsByScope);
    replacementTargetsByProjectAndUrl.set(target.projectId, targetsByUrl);
  }

  for (const domain of domains) {
    const url = `https://${domain.domain}`;
    const origin = normalizedOrigin(url);
    const replacementComponents = origin === null
      ? undefined
      : replacementComponentsByProjectAndOrigin
        .get(domain.projectId)
        ?.get(origin);
    const replacementUrl = domain.componentId === null
      ? undefined
      : replacementComponents?.get(domain.componentId);
    const fallbackReplacementUrl = replacementComponents === undefined
      ? undefined
      : [...replacementComponents]
        .sort(([firstId], [secondId]) => firstId.localeCompare(secondId))[0]?.[1];
    const selectedReplacementUrl = replacementUrl ?? fallbackReplacementUrl;
    const target: HealthTarget = {
      projectId: domain.projectId,
      componentId: domain.componentId,
      resourceId: null,
    };
    if (selectedReplacementUrl !== undefined) {
      addReplacementTarget(selectedReplacementUrl, target);
      continue;
    }
    addTarget(url, 'domain', target);
  }
  for (const component of components) {
    const url = component.healthUrl ?? component.url;
    if (url !== null) {
      addTarget(url, 'component', {
        projectId: component.projectId,
        componentId: component.componentId,
        resourceId: null,
      });
    }
  }

  return [...targetsByProjectAndUrl].flatMap(([projectId, targetsByUrl]) => (
    [...targetsByUrl].map(([url, candidate]) => {
      const targetsByScope = new Map<string, HealthTarget>([
        [healthTargetScopeKey(candidate.target), candidate.target],
      ]);
      const replacementTargets = replacementTargetsByProjectAndUrl
        .get(projectId)
        ?.get(url);
      for (const [scope, target] of replacementTargets ?? []) {
        targetsByScope.set(scope, target);
      }
      return {
        url,
        targets: [...targetsByScope.values()],
      };
    })
  ));
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
        await Promise.all(healthCheck.targets.map(async (target) => {
          await recordChangeIfChanged(db, {
            projectId: target.projectId,
            componentId: target.componentId,
            resourceId: target.resourceId,
            kind: 'health_status',
            severity: value.severity,
            currentValue: value.currentValue,
            detail: `Health check for ${healthCheck.url}`,
          });
        }));
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
