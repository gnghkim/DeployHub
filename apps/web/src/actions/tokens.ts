'use server';

import { revalidatePath } from 'next/cache';
import { issueToken, revokeToken } from '@deployhub/db';
import { auth } from '../auth/config';
import { db } from '../lib/db';

export type TokenActionState = {
  status: 'idle' | 'success' | 'error';
  message?: string;
  rawToken?: string;
};

const optionalText = (value: FormDataEntryValue | null): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

export async function issueRegistrationToken(
  formData: FormData,
): Promise<TokenActionState> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error('인증이 필요합니다.');

  const expiresInHours = Number(formData.get('expiresInHours'));
  const maxUses = Number(formData.get('maxUses'));
  if (
    !Number.isInteger(expiresInHours)
    || expiresInHours < 1
    || expiresInHours > 24 * 30
    || !Number.isInteger(maxUses)
    || maxUses < 1
    || maxUses > 100
  ) {
    return {
      status: 'error',
      message: '만료 시간과 사용 횟수를 확인해 주세요.',
    };
  }

  const expiresAt = new Date(
    Date.now() + expiresInHours * 60 * 60 * 1_000,
  );
  const issued = await issueToken(db, {
    scope: 'project:draft:create',
    repositoryConstraint: optionalText(
      formData.get('repositoryConstraint'),
    ),
    projectSlugConstraint: optionalText(
      formData.get('projectSlugConstraint'),
    ),
    expiresAt,
    maxUses,
    createdBy: userId,
  });

  revalidatePath('/settings/tokens');
  return {
    status: 'success',
    message: '등록 토큰을 발급했습니다. 이 값은 다시 표시되지 않습니다.',
    rawToken: issued.raw,
  };
}

export async function revokeRegistrationToken(id: string): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error('인증이 필요합니다.');

  await revokeToken(db, id);
  revalidatePath('/settings/tokens');
}
