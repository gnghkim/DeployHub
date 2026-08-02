import { lt, sql } from 'drizzle-orm';
import type { Db } from '../client';
import {
  containerSnapshots,
  deployments,
} from '../schema/observations';

export type SnapshotInput = Pick<
  typeof containerSnapshots.$inferInsert,
  'resourceId' | 'cpuPct' | 'memBytes' | 'restartCount'
>;

export type DeploymentInput = Pick<
  typeof deployments.$inferInsert,
  'provider' | 'environment' | 'externalDeploymentId' | 'status'
> & Partial<Pick<
  typeof deployments.$inferInsert,
  | 'projectId'
  | 'componentId'
  | 'version'
  | 'commitSha'
  | 'imageName'
  | 'deploymentUrl'
  | 'startedAt'
  | 'completedAt'
  | 'metadata'
>>;

export async function recordSnapshots(
  db: Db,
  rows: SnapshotInput[],
): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(containerSnapshots).values(rows.map((row) => ({
    resourceId: row.resourceId,
    cpuPct: row.cpuPct,
    memBytes: row.memBytes,
    restartCount: row.restartCount,
  })));
}

export async function pruneSnapshots(
  db: Db,
  olderThanDays: number,
): Promise<number> {
  const deleted = await db
    .delete(containerSnapshots)
    .where(lt(
      containerSnapshots.observedAt,
      sql`now() - ${olderThanDays} * interval '1 day'`,
    ))
    .returning({ id: containerSnapshots.id });
  return deleted.length;
}

export async function upsertDeployment(
  db: Db,
  input: DeploymentInput,
): Promise<{ id: string; inserted: boolean }> {
  const [inserted] = await db
    .insert(deployments)
    .values(input)
    .onConflictDoNothing({
      target: [deployments.provider, deployments.externalDeploymentId],
    })
    .returning({ id: deployments.id });
  if (inserted !== undefined) return { id: inserted.id, inserted: true };

  const [updated] = await db
    .update(deployments)
    .set({
      projectId: input.projectId,
      componentId: input.componentId,
      environment: input.environment,
      version: input.version,
      commitSha: input.commitSha,
      imageName: input.imageName,
      status: input.status,
      deploymentUrl: input.deploymentUrl,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      metadata: input.metadata,
    })
    .where(sql`${deployments.provider} = ${input.provider}
      and ${deployments.externalDeploymentId} = ${input.externalDeploymentId}`)
    .returning({ id: deployments.id });
  if (updated === undefined) throw new Error('deployment upsert failed');
  return { id: updated.id, inserted: false };
}
