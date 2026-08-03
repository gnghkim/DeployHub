import {
  and,
  eq,
  isNull,
  notInArray,
  sql,
} from 'drizzle-orm';
import {
  createSupabaseCollector,
  type SupabaseCollector,
} from '@deployhub/collectors';
import {
  enqueueUnique,
  linkDeclaredResources,
  schema,
  type Db,
} from '@deployhub/db';
import { decrypt } from '@deployhub/shared';
import type { JobHandler } from '../runner';

const SYNC_ERROR = 'Supabase 동기화에 실패했습니다.';

type SupabaseSyncDependencies = {
  createCollector?: (token: string) => SupabaseCollector;
};

function safeSyncError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const status = /\bHTTP\s+(\d{3})\b/.exec(message)?.[1];
  return status === undefined
    ? SYNC_ERROR
    : `${SYNC_ERROR} (HTTP ${status})`;
}

export function createSupabaseSyncHandler(
  db: Db,
  encryptionKey: Buffer,
  dependencies: SupabaseSyncDependencies = {},
): JobHandler {
  const createCollector = dependencies.createCollector
    ?? createSupabaseCollector;

  return async (job) => {
    const accountId = typeof job.payload.accountId === 'string'
      ? job.payload.accountId
      : undefined;
    if (accountId === undefined) {
      throw new Error('Supabase 동기화 accountId가 없습니다.');
    }

    const [account] = await db
      .select()
      .from(schema.providerAccounts)
      .where(
        and(
          eq(schema.providerAccounts.id, accountId),
          eq(schema.providerAccounts.provider, 'supabase'),
        ),
      );
    if (!account) {
      throw new Error('Supabase 계정을 찾을 수 없습니다.');
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
              provider: 'supabase',
              providerAccountId: account.id,
              externalId: resource.externalId,
              resourceType: 'supabase_project',
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
                resourceType: 'supabase_project',
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
          eq(schema.resources.provider, 'supabase'),
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

        await linkDeclaredResources(tx, {
          provider: 'supabase',
          externalIds,
        });
        await tx
          .update(schema.providerAccounts)
          .set({
            lastSyncAt: sql`now()`,
            lastError: null,
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

export async function enqueueSupabaseSyncJobs(db: Db): Promise<void> {
  const accounts = await db
    .select({ id: schema.providerAccounts.id })
    .from(schema.providerAccounts)
    .where(eq(schema.providerAccounts.provider, 'supabase'));

  for (const { id } of accounts) {
    await enqueueUnique(db, {
      type: 'supabase.sync',
      dedupeKey: `supabase:${id}`,
      payload: { accountId: id },
    });
  }
}
