import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createGithubCollector: vi.fn(),
  encrypt: vi.fn(),
  loadEncryptionKey: vi.fn(),
  enqueue: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  onConflictDoUpdate: vi.fn(),
}));

vi.mock('../auth/config', () => ({ auth: mocks.auth }));
vi.mock('../lib/db', () => ({
  db: { insert: mocks.insert },
}));
vi.mock('@deployhub/collectors', () => ({
  createGithubCollector: mocks.createGithubCollector,
}));
vi.mock('@deployhub/shared', () => ({
  encrypt: mocks.encrypt,
  loadEncryptionKey: mocks.loadEncryptionKey,
}));
vi.mock('@deployhub/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@deployhub/db')>()),
  enqueue: mocks.enqueue,
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import {
  enqueueGithubSync,
  saveGithubProvider,
} from './providers';

const emptyState = { status: 'idle' as const };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(null);
  mocks.insert.mockReturnValue({ values: mocks.values });
  mocks.values.mockReturnValue({
    onConflictDoUpdate: mocks.onConflictDoUpdate,
  });
  mocks.onConflictDoUpdate.mockResolvedValue(undefined);
  mocks.loadEncryptionKey.mockReturnValue(Buffer.alloc(32));
  mocks.encrypt.mockReturnValue('encrypted-payload');
});

describe('Provider Server Actions', () => {
  it('세션이 없으면 토큰 저장을 거부한다', async () => {
    await expect(
      saveGithubProvider(emptyState, new FormData()),
    ).rejects.toThrow(/인증/);
  });

  it('연결 오류에 토큰을 되비추지 않는다', async () => {
    const token = 'github_pat_connectionFailureSecret';
    mocks.auth.mockResolvedValue({ user: { id: 'user-id' } });
    mocks.createGithubCollector.mockReturnValue({
      testConnection: vi.fn().mockResolvedValue({
        ok: false,
        error: `Bad credentials: ${token}`,
      }),
    });
    const formData = new FormData();
    formData.set('token', token);

    const result = await saveGithubProvider(emptyState, formData);

    expect(result.status).toBe('error');
    expect(JSON.stringify(result)).not.toContain(token);
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('검증된 토큰은 암호문만 저장한다', async () => {
    const token = 'github-token-secret';
    mocks.auth.mockResolvedValue({ user: { id: 'user-id' } });
    mocks.createGithubCollector.mockReturnValue({
      testConnection: vi.fn().mockResolvedValue({
        ok: true,
        account: 'octocat',
      }),
    });
    const formData = new FormData();
    formData.set('token', token);

    const result = await saveGithubProvider(emptyState, formData);

    expect(result.status).toBe('success');
    expect(mocks.encrypt).toHaveBeenCalledWith(token, Buffer.alloc(32));
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'github',
        name: 'octocat',
        encryptedToken: 'encrypted-payload',
      }),
    );
    expect(JSON.stringify(mocks.values.mock.calls[0]?.[0])).not.toContain(
      token,
    );
  });

  it('세션이 없으면 수동 동기화를 거부한다', async () => {
    const formData = new FormData();
    formData.set('accountId', 'account-id');
    await expect(enqueueGithubSync(formData)).rejects.toThrow(/인증/);
  });
});
