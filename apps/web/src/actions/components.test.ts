import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
}));

vi.mock('../auth/config', () => ({ auth: authMock }));
vi.mock('../lib/db', () => ({ db: {} }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { createComponent, deleteComponent, updateComponent } from './components';

const emptyState = { status: 'idle' as const };

beforeEach(() => {
  authMock.mockReset();
  authMock.mockResolvedValue(null);
});

describe('구성요소 Server Actions 인증', () => {
  it('createComponent 는 세션이 없으면 즉시 거부한다', async () => {
    await expect(
      createComponent('project-id', emptyState, new FormData()),
    ).rejects.toThrow(/인증/);
  });

  it('updateComponent 는 세션이 없으면 즉시 거부한다', async () => {
    await expect(
      updateComponent('component-id', emptyState, new FormData()),
    ).rejects.toThrow(/인증/);
  });

  it('deleteComponent 는 세션이 없으면 즉시 거부한다', async () => {
    await expect(deleteComponent('component-id')).rejects.toThrow(/인증/);
  });
});
