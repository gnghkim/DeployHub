'use server';

import { sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { createGithubCollector } from '@deployhub/collectors';
import { enqueue, schema } from '@deployhub/db';
import { encrypt, loadEncryptionKey } from '@deployhub/shared';
import { auth } from '../auth/config';
import { db } from '../lib/db';

export type ProviderActionState = {
  status: 'idle' | 'error' | 'success';
  message?: string;
};

const CONNECTION_ERROR = 'GitHub 연결을 확인하지 못했습니다.';

export async function saveGithubProvider(
  _previousState: ProviderActionState,
  formData: FormData,
): Promise<ProviderActionState> {
  const session = await auth();
  if (!session) throw new Error('인증이 필요합니다.');

  const value = formData.get('token');
  const token = typeof value === 'string' ? value.trim() : '';
  if (token === '') {
    return { status: 'error', message: 'GitHub 토큰을 입력해 주세요.' };
  }

  const connection = await createGithubCollector(token).testConnection();
  if (!connection.ok) {
    return { status: 'error', message: CONNECTION_ERROR };
  }

  try {
    const encryptionKey = loadEncryptionKey(process.env.ENCRYPTION_KEY);
    const encryptedToken = encrypt(token, encryptionKey);
    await db
      .insert(schema.providerAccounts)
      .values({
        provider: 'github',
        name: connection.account,
        encryptedToken,
        lastVerifiedAt: sql`now()`,
        lastError: null,
      })
      .onConflictDoUpdate({
        target: [
          schema.providerAccounts.provider,
          schema.providerAccounts.name,
        ],
        set: {
          encryptedToken,
          lastVerifiedAt: sql`now()`,
          lastError: null,
        },
      });
  } catch {
    return {
      status: 'error',
      message: 'GitHub 연결 정보를 저장하지 못했습니다.',
    };
  }

  revalidatePath('/providers');
  return {
    status: 'success',
    message: 'GitHub 연결을 확인하고 안전하게 저장했습니다.',
  };
}

export async function enqueueGithubSync(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session) throw new Error('인증이 필요합니다.');

  const value = formData.get('accountId');
  const accountId = typeof value === 'string' ? value : '';
  if (accountId === '') {
    throw new Error('GitHub 계정 ID가 필요합니다.');
  }

  await enqueue(db, {
    type: 'github.sync',
    payload: { accountId },
  });
  revalidatePath('/providers');
}
