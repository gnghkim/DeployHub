import {
  createDockerCollector,
  extractContainerHealth,
  type ContainerHealth,
  type DockerCollector,
} from '@deployhub/collectors';
import {
  enqueueUnique,
  recordChangeIfChanged,
  schema,
  type Db,
} from '@deployhub/db';
import {
  and,
  asc,
  desc,
  eq,
  isNull,
  ne,
} from 'drizzle-orm';
import type { JobHandler } from '../runner';

export const DOCKER_HEALTH_INTERVAL_MS = 60 * 1_000;

type DockerHealthDependencies = {
  createCollector?: (
    baseUrl: string,
  ) => Pick<DockerCollector, 'listContainerStatuses'>;
};

type DockerHealthTarget = {
  resourceId: string;
  externalId: string;
  componentId: string | null;
  projectId: string | null;
  projectArchivedAt: Date | null;
};

function configuredBaseUrl(baseUrl: string | undefined): string | null {
  if (baseUrl === undefined || baseUrl.trim() === '') return null;
  return baseUrl.trim();
}

function stateSeverity(
  state: string,
): 'info' | 'warning' | 'critical' {
  if (state === 'running') return 'info';
  if (state === 'exited' || state === 'dead') return 'critical';
  return 'warning';
}

function healthSeverity(
  health: ContainerHealth,
): 'info' | 'critical' {
  return health === 'unhealthy' ? 'critical' : 'info';
}

async function dockerHealthTargets(db: Db): Promise<DockerHealthTarget[]> {
  const rows = await db
    .select({
      resourceId: schema.resources.id,
      externalId: schema.resources.externalId,
      componentId: schema.componentResources.componentId,
      projectId: schema.components.projectId,
      projectArchivedAt: schema.projects.archivedAt,
    })
    .from(schema.resources)
    .leftJoin(
      schema.componentResources,
      and(
        eq(
          schema.componentResources.resourceId,
          schema.resources.id,
        ),
        ne(schema.componentResources.linkedBy, 'suggested'),
      ),
    )
    .leftJoin(
      schema.components,
      eq(
        schema.components.id,
        schema.componentResources.componentId,
      ),
    )
    .leftJoin(
      schema.projects,
      eq(schema.projects.id, schema.components.projectId),
    )
    .where(
      and(
        eq(schema.resources.provider, 'docker'),
        isNull(schema.resources.deletedAt),
      ),
    )
    .orderBy(
      desc(schema.componentResources.isPrimary),
      asc(schema.componentResources.createdAt),
    );
  const targets = new Map<string, DockerHealthTarget>();

  for (const row of rows) {
    if (
      row.componentId === null
      && !targets.has(row.resourceId)
    ) {
      targets.set(row.resourceId, row);
      continue;
    }
    if (
      row.componentId !== null
      && row.projectArchivedAt === null
      && (
        !targets.has(row.resourceId)
        || targets.get(row.resourceId)?.componentId === null
      )
    ) {
      targets.set(row.resourceId, row);
    }
  }
  return [...targets.values()];
}

export function createDockerHealthHandler(
  db: Db,
  baseUrl: string | undefined,
  dependencies: DockerHealthDependencies = {},
): JobHandler {
  const createCollector = dependencies.createCollector
    ?? createDockerCollector;

  return async () => {
    const configuredUrl = configuredBaseUrl(baseUrl);
    if (configuredUrl === null) return;

    const targets = await dockerHealthTargets(db);
    const targetByExternalId = new Map(
      targets.map((target) => [target.externalId, target]),
    );
    const collector = createCollector(configuredUrl);

    // Keep this to one Docker API request. Per-container inspect or stats calls
    // can exceed runner.ts's 300-second lease and run the same job twice.
    const statuses = await collector.listContainerStatuses();

    for (const status of statuses) {
      const target = targetByExternalId.get(status.externalId);
      if (target === undefined) continue;

      await recordChangeIfChanged(db, {
        projectId: target.projectId,
        componentId: target.componentId,
        resourceId: target.resourceId,
        kind: 'container_status',
        severity: stateSeverity(status.state),
        currentValue: status.state,
        detail: `Docker container status for ${status.name}`,
      });

      const health = extractContainerHealth(status.status);
      if (health !== null) {
        await recordChangeIfChanged(db, {
          projectId: target.projectId,
          componentId: target.componentId,
          resourceId: target.resourceId,
          kind: 'container_health',
          severity: healthSeverity(health),
          currentValue: health,
          detail: `Docker container health for ${status.name}`,
        });
      }
    }
  };
}

export async function enqueueDockerHealthJob(
  db: Db,
  baseUrl: string | undefined,
): Promise<void> {
  if (configuredBaseUrl(baseUrl) === null) return;
  await enqueueUnique(db, {
    type: 'docker.health',
    payload: {},
  });
}
