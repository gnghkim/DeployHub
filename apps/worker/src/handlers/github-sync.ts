import {
  and,
  eq,
  isNull,
  notInArray,
  sql,
} from 'drizzle-orm';
import {
  createGithubCollector,
  type ProviderCollector,
} from '@deployhub/collectors';
import {
  enqueue,
  schema,
  type Db,
} from '@deployhub/db';
import { decrypt } from '@deployhub/shared';
import type { JobHandler } from '../runner';

const SYNC_ERROR = 'GitHub 동기화에 실패했습니다.';

type GithubSyncDependencies = {
  createCollector?: (token: string) => ProviderCollector;
};

export function createGithubSyncHandler(
  db: Db,
  encryptionKey: Buffer,
  dependencies: GithubSyncDependencies = {},
): JobHandler {
  const createCollector = dependencies.createCollector ?? createGithubCollector;

  return async (job) => {
    const accountId =
      typeof job.payload.accountId === 'string'
        ? job.payload.accountId
        : undefined;
    if (accountId === undefined) {
      throw new Error('GitHub 동기화 accountId가 없습니다.');
    }

    const [account] = await db
      .select()
      .from(schema.providerAccounts)
      .where(
        and(
          eq(schema.providerAccounts.id, accountId),
          eq(schema.providerAccounts.provider, 'github'),
        ),
      );
    if (!account) {
      throw new Error('GitHub 계정을 찾을 수 없습니다.');
    }

    try {
      const token = decrypt(account.encryptedToken, encryptionKey);
      const resources = await createCollector(token).listResources();
      const externalIds = resources.map((resource) => resource.externalId);

      await db.transaction(async (tx) => {
        for (const resource of resources) {
          await tx
            .insert(schema.resources)
            .values({
              provider: 'github',
              providerAccountId: account.id,
              externalId: resource.externalId,
              resourceType: 'github_repository',
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
                resourceType: 'github_repository',
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
          eq(schema.resources.provider, 'github'),
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

        await tx
          .update(schema.providerAccounts)
          .set({
            lastSyncAt: sql`now()`,
            lastError: null,
          })
          .where(eq(schema.providerAccounts.id, account.id));
      });
    } catch {
      await db
        .update(schema.providerAccounts)
        .set({ lastError: SYNC_ERROR })
        .where(eq(schema.providerAccounts.id, account.id));
      throw new Error(SYNC_ERROR);
    }
  };
}

export async function enqueueGithubSyncJobs(db: Db): Promise<void> {
  const accounts = await db
    .select({ id: schema.providerAccounts.id })
    .from(schema.providerAccounts)
    .where(eq(schema.providerAccounts.provider, 'github'));

  await Promise.all(
    accounts.map(async ({ id }) =>
      enqueue(db, {
        type: 'github.sync',
        payload: { accountId: id },
      }),
    ),
  );
}
