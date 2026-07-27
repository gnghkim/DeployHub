import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  notInArray,
  sql,
} from 'drizzle-orm';
import {
  createVercelCollector,
  type VercelCollector,
} from '@deployhub/collectors';
import {
  enqueue,
  schema,
  type Db,
} from '@deployhub/db';
import { decrypt } from '@deployhub/shared';
import type { JobHandler } from '../runner';

const SYNC_ERROR = 'Vercel 동기화에 실패했습니다.';
const ZERO_PROJECTS_WARNING =
  '프로젝트 0건. 팀 계정 토큰이면 teamId 지정이 필요한데 아직 지원하지 않습니다.';

type VercelSyncDependencies = {
  createCollector?: (token: string) => VercelCollector;
};

function safeSyncError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const status = /\bHTTP\s+(\d{3})\b/.exec(message)?.[1];
  return status === undefined
    ? SYNC_ERROR
    : `${SYNC_ERROR} (HTTP ${status})`;
}

function deploymentDate(value: string | undefined): Date | null {
  if (value === undefined) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Vercel 배포 시각 형식이 올바르지 않습니다.');
  }
  return parsed;
}

export function createVercelSyncHandler(
  db: Db,
  encryptionKey: Buffer,
  dependencies: VercelSyncDependencies = {},
): JobHandler {
  const createCollector = dependencies.createCollector
    ?? createVercelCollector;

  return async (job) => {
    const accountId = typeof job.payload.accountId === 'string'
      ? job.payload.accountId
      : undefined;
    if (accountId === undefined) {
      throw new Error('Vercel 동기화 accountId가 없습니다.');
    }

    const [account] = await db
      .select()
      .from(schema.providerAccounts)
      .where(
        and(
          eq(schema.providerAccounts.id, accountId),
          eq(schema.providerAccounts.provider, 'vercel'),
        ),
      );
    if (!account) {
      throw new Error('Vercel 계정을 찾을 수 없습니다.');
    }

    try {
      const token = decrypt(account.encryptedToken, encryptionKey);
      const collector = createCollector(token);
      const resources = await collector.listResources();
      const deployments = await collector.listDeployments();
      const externalIds = resources.map((resource) => resource.externalId);

      await db.transaction(async (tx) => {
        for (const resource of resources) {
          await tx
            .insert(schema.resources)
            .values({
              provider: 'vercel',
              providerAccountId: account.id,
              externalId: resource.externalId,
              resourceType: 'vercel_project',
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
                providerAccountId: account.id,
                resourceType: 'vercel_project',
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
          eq(schema.resources.provider, 'vercel'),
          eq(schema.resources.providerAccountId, account.id),
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

        const deploymentResourceIds = [
          ...new Set(
            deployments.map((deployment) =>
              deployment.resourceExternalId
            ),
          ),
        ];
        const links = deploymentResourceIds.length === 0
          ? []
          : await tx
            .select({
              externalId: schema.resources.externalId,
              componentId: schema.componentResources.componentId,
              projectId: schema.components.projectId,
              isPrimary: schema.componentResources.isPrimary,
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
            .where(
              and(
                eq(schema.resources.provider, 'vercel'),
                inArray(
                  schema.resources.externalId,
                  deploymentResourceIds,
                ),
              ),
            )
            .orderBy(
              desc(schema.componentResources.isPrimary),
              asc(schema.componentResources.createdAt),
            );
        const linkByExternalId = new Map<
          string,
          { componentId: string; projectId: string }
        >();
        for (const link of links) {
          if (
            !linkByExternalId.has(link.externalId)
            && link.componentId !== null
            && link.projectId !== null
          ) {
            linkByExternalId.set(link.externalId, {
              componentId: link.componentId,
              projectId: link.projectId,
            });
          }
        }

        for (const deployment of deployments) {
          const link = linkByExternalId.get(
            deployment.resourceExternalId,
          );
          const values = {
            projectId: link?.projectId ?? null,
            componentId: link?.componentId ?? null,
            provider: 'vercel' as const,
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
          await tx
            .insert(schema.deployments)
            .values(values)
            .onConflictDoUpdate({
              target: [
                schema.deployments.provider,
                schema.deployments.externalDeploymentId,
              ],
              set: values,
            });
        }

        await tx
          .update(schema.providerAccounts)
          .set({
            lastSyncAt: sql`now()`,
            lastError: resources.length === 0
              ? ZERO_PROJECTS_WARNING
              : null,
          })
          .where(eq(schema.providerAccounts.id, account.id));
      });
    } catch (error) {
      const message = safeSyncError(error);
      await db
        .update(schema.providerAccounts)
        .set({ lastError: message })
        .where(eq(schema.providerAccounts.id, account.id));
      throw new Error(message);
    }
  };
}

export async function enqueueVercelSyncJobs(db: Db): Promise<void> {
  const accounts = await db
    .select({ id: schema.providerAccounts.id })
    .from(schema.providerAccounts)
    .where(eq(schema.providerAccounts.provider, 'vercel'));

  await Promise.all(
    accounts.map(async ({ id }) =>
      enqueue(db, {
        type: 'vercel.sync',
        payload: { accountId: id },
      }),
    ),
  );
}
