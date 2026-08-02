import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  notInArray,
  sql,
} from 'drizzle-orm';
import {
  createDockerCollector,
  type DockerCollector,
} from '@deployhub/collectors';
import {
  enqueue,
  linkDeclaredResources,
  schema,
  type Db,
  upsertDeployment,
} from '@deployhub/db';
import type { JobHandler } from '../runner';
import { isSuccessfulProductionDeployment } from './deployment-snapshot';
import { enqueueSnapshotCaptureInTransaction } from './snapshot-capture';

const SYNC_ERROR = 'Docker 동기화에 실패했습니다.';
const SNAPSHOT_RETENTION_DAYS = 14;
const CHANGE_EVENT_RETENTION_DAYS = 90;

type DockerSyncDependencies = {
  createCollector?: (baseUrl: string) => DockerCollector;
  enqueueCapture?: typeof enqueueSnapshotCaptureInTransaction;
};

function configuredBaseUrl(baseUrl: string | undefined): string | null {
  if (baseUrl === undefined || baseUrl.trim() === '') return null;
  return baseUrl.trim();
}

function safeSyncError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const status = /\bHTTP\s+(\d{3})\b/.exec(message)?.[1];
  const containerCount =
    /컨테이너\s+(\d+)건/.exec(message)?.[1];
  const limit = /상한\s+(\d+)건/.exec(message)?.[1];
  const details: string[] = [];
  if (status !== undefined) details.push(`HTTP ${status}`);
  if (containerCount !== undefined) {
    details.push(`컨테이너 ${containerCount}건`);
  }
  if (limit !== undefined) details.push(`상한 ${limit}건`);
  return details.length === 0
    ? SYNC_ERROR
    : `${SYNC_ERROR} (${details.join(', ')})`;
}

function deploymentDate(value: string | undefined): Date | null {
  if (value === undefined) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Docker 배포 시각 형식이 올바르지 않습니다.');
  }
  return parsed;
}

export function createDockerSyncHandler(
  db: Db,
  baseUrl: string | undefined,
  dependencies: DockerSyncDependencies = {},
): JobHandler {
  const createCollector = dependencies.createCollector
    ?? createDockerCollector;
  const enqueueCapture = dependencies.enqueueCapture
    ?? enqueueSnapshotCaptureInTransaction;

  return async () => {
    const configuredUrl = configuredBaseUrl(baseUrl);
    if (configuredUrl === null) return;

    try {
      const collector = createCollector(configuredUrl);
      const [resources, deployments, snapshots] = await Promise.all([
        collector.listResources(),
        collector.listDeployments(),
        collector.listSnapshots(),
      ]);
      const externalIds = resources.map(
        (resource) => resource.externalId,
      );

      await db.transaction(async (tx) => {
        const candidates: Array<{
          projectId: string;
          url: string;
          deploymentId: string;
        }> = [];
        for (const resource of resources) {
          await tx
            .insert(schema.resources)
            .values({
              provider: 'docker',
              externalId: resource.externalId,
              resourceType: 'docker_container',
              name: resource.name,
              status: resource.status ?? null,
              region: resource.region ?? null,
              url: resource.url ?? null,
              metadata: resource.metadata,
              lastSeenAt: sql`now()`,
              deletedAt: null,
            })
            .onConflictDoUpdate({
              target: [
                schema.resources.provider,
                schema.resources.externalId,
              ],
              set: {
                providerAccountId: null,
                resourceType: 'docker_container',
                name: resource.name,
                status: resource.status ?? null,
                region: resource.region ?? null,
                url: resource.url ?? null,
                metadata: resource.metadata,
                lastSeenAt: sql`now()`,
                deletedAt: null,
              },
            });
        }

        const missingConditions = [
          eq(schema.resources.provider, 'docker'),
          isNull(schema.resources.deletedAt),
        ];
        if (externalIds.length > 0) {
          missingConditions.push(
            notInArray(schema.resources.externalId, externalIds),
          );
        }
        await tx
          .update(schema.resources)
          .set({ deletedAt: sql`now()` })
          .where(and(...missingConditions));

        await linkDeclaredResources(tx, {
          provider: 'docker',
          externalIds,
        });

        const links = externalIds.length === 0
          ? []
          : await tx
            .select({
              id: schema.resources.id,
              externalId: schema.resources.externalId,
              componentId: schema.componentResources.componentId,
              projectId: schema.components.projectId,
              snapshotMode: schema.projects.snapshotMode,
              snapshotUrl: schema.projects.snapshotUrl,
            })
            .from(schema.resources)
            .leftJoin(
              schema.componentResources,
              eq(
                schema.componentResources.resourceId,
                schema.resources.id,
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
                inArray(schema.resources.externalId, externalIds),
              ),
            )
            .orderBy(
              desc(schema.componentResources.isPrimary),
              asc(schema.componentResources.createdAt),
            );
        const resourceByExternalId = new Map<
          string,
          {
            id: string;
            componentId: string | null;
            projectId: string | null;
            snapshotMode: 'disabled' | 'automatic' | 'manual' | null;
            snapshotUrl: string | null;
          }
        >();
        for (const link of links) {
          if (!resourceByExternalId.has(link.externalId)) {
            resourceByExternalId.set(link.externalId, {
              id: link.id,
              componentId: link.componentId,
              projectId: link.projectId,
              snapshotMode: link.snapshotMode,
              snapshotUrl: link.snapshotUrl,
            });
          }
        }

        if (snapshots.length > 0) {
          const snapshotRows = snapshots.map((snapshot) => {
            const resource = resourceByExternalId.get(
              snapshot.resourceExternalId,
            );
            if (resource === undefined) {
              throw new Error(
                'Docker 스냅샷 자원을 찾을 수 없습니다.',
              );
            }
            return {
              resourceId: resource.id,
              cpuPct: snapshot.cpuPct,
              memBytes: snapshot.memBytes,
              restartCount: snapshot.restartCount,
              observedAt: sql`now()`,
            };
          });
          await tx.insert(schema.containerSnapshots).values(snapshotRows);
        }

        await tx
          .delete(schema.containerSnapshots)
          .where(
            lt(
              schema.containerSnapshots.observedAt,
              sql`now() - ${SNAPSHOT_RETENTION_DAYS} * interval '1 day'`,
            ),
          );

        await tx.execute(sql`
          delete from ${schema.changeEvents} as old_event
          where old_event.occurred_at
              < now() - ${CHANGE_EVENT_RETENTION_DAYS} * interval '1 day'
            and exists (
              select 1
              from ${schema.changeEvents} as newer_event
              where coalesce(
                  newer_event.resource_id::text,
                  newer_event.component_id::text,
                  newer_event.project_id::text,
                  'global'
                ) = coalesce(
                  old_event.resource_id::text,
                  old_event.component_id::text,
                  old_event.project_id::text,
                  'global'
                )
                and newer_event.kind = old_event.kind
                and newer_event.seq > old_event.seq
            )
        `);

        for (const deployment of deployments) {
          const resource = resourceByExternalId.get(
            deployment.resourceExternalId,
          );
          const values = {
            projectId: resource?.projectId ?? null,
            componentId: resource?.componentId ?? null,
            provider: 'docker' as const,
            environment: deployment.environment,
            version: deployment.version ?? null,
            commitSha: deployment.commitSha ?? null,
            imageName: deployment.imageName ?? null,
            externalDeploymentId: deployment.externalDeploymentId,
            status: deployment.status,
            deploymentUrl: deployment.deploymentUrl ?? null,
            startedAt: deploymentDate(deployment.startedAt),
            completedAt: deploymentDate(deployment.completedAt),
            metadata: deployment.metadata,
          };
          const saved = await upsertDeployment(tx, values);
          if (
            saved.inserted
            && resource?.projectId !== null
            && resource?.projectId !== undefined
            && resource.snapshotMode === 'automatic'
            && resource.snapshotUrl !== null
            && isSuccessfulProductionDeployment({
              provider: 'docker',
              environment: deployment.environment,
              status: deployment.status,
            })
          ) {
            candidates.push({
              projectId: resource.projectId,
              url: resource.snapshotUrl,
              deploymentId: saved.id,
            });
          }
        }
        for (const candidate of candidates) {
          await enqueueCapture(tx, candidate);
        }
      });
    } catch (error) {
      throw new Error(safeSyncError(error));
    }
  };
}

export async function enqueueDockerSyncJob(
  db: Db,
  baseUrl: string | undefined,
): Promise<void> {
  if (configuredBaseUrl(baseUrl) === null) return;
  await enqueue(db, {
    type: 'docker.sync',
    payload: {},
  });
}
