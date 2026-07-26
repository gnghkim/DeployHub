import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
}));

vi.mock('../auth/config', () => ({ auth: authMock }));
vi.mock('../lib/db', () => ({ db: {} }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import { archiveProject, createProject, updateProject } from './projects';

const emptyState = { status: 'idle' as const };

beforeEach(() => {
  authMock.mockReset();
  authMock.mockResolvedValue(null);
});

describe('프로젝트 Server Actions 인증', () => {
  it('createProject 는 세션이 없으면 즉시 거부한다', async () => {
    await expect(createProject(emptyState, new FormData())).rejects.toThrow(/인증/);
  });

  it('updateProject 는 세션이 없으면 즉시 거부한다', async () => {
    await expect(updateProject('project-id', emptyState, new FormData())).rejects.toThrow(/인증/);
  });

  it('archiveProject 는 세션이 없으면 즉시 거부한다', async () => {
    await expect(archiveProject('project-id')).rejects.toThrow(/인증/);
  });
});
