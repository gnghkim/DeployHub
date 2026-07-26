import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
  values: vi.fn(),
  onConflictDoNothing: vi.fn(),
  returning: vi.fn(),
}));

vi.mock('../auth/config', () => ({ auth: mocks.auth }));
vi.mock('../lib/db', () => ({
  db: {
    select: mocks.select,
    insert: mocks.insert,
    delete: mocks.delete,
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import {
  confirmResourceLink,
  removeResourceLink,
} from './links';

const emptyState = { status: 'idle' as const };

type MatchContext = {
  componentId: string;
  projectId: string;
  projectSlug: string;
  repository: string | null;
  resourceId: string;
  externalId: string;
  resourceName: string;
};

function mockMatchContext(context: MatchContext) {
  const componentWhere = vi.fn().mockResolvedValue([
    {
      componentId: context.componentId,
      projectId: context.projectId,
      projectSlug: context.projectSlug,
      repository: context.repository,
    },
  ]);
  const resourceWhere = vi.fn().mockResolvedValue([
    {
      resourceId: context.resourceId,
      externalId: context.externalId,
      resourceName: context.resourceName,
    },
  ]);

  mocks.select
    .mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: componentWhere,
        }),
      }),
    })
    .mockReturnValueOnce({
      from: vi.fn().mockReturnValue({
        where: resourceWhere,
      }),
    });
}

function linkFormData(resourceId = 'resource-id', componentId = 'component-id') {
  const formData = new FormData();
  formData.set('resourceId', resourceId);
  formData.set('componentId', componentId);
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(null);
  mocks.insert.mockReturnValue({ values: mocks.values });
  mocks.values.mockReturnValue({
    onConflictDoNothing: mocks.onConflictDoNothing,
  });
  mocks.onConflictDoNothing.mockReturnValue({ returning: mocks.returning });
  mocks.returning.mockResolvedValue([{ id: 'link-id' }]);
});

describe('자원 연결 Server Action', () => {
  it('세션이 없으면 DB 조회 전에 즉시 거부한다', async () => {
    await expect(
      confirmResourceLink(emptyState, linkFormData()),
    ).rejects.toThrow(/인증/);

    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('repository 정확 일치를 사람이 확인하면 repository 근거로 저장한다', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'user-id' } });
    mockMatchContext({
      componentId: 'component-id',
      projectId: 'project-id',
      projectSlug: 'workwiki',
      repository: 'KTGO/WorkWiki',
      resourceId: 'resource-id',
      externalId: 'ktgo/workwiki',
      resourceName: 'workwiki',
    });

    await confirmResourceLink(emptyState, linkFormData());

    expect(mocks.values).toHaveBeenCalledWith({
      componentId: 'component-id',
      resourceId: 'resource-id',
      environment: 'production',
      relationType: 'uses',
      isPrimary: false,
      linkedBy: 'repository',
    });
  });

  it('name 정확 일치를 사람이 확인하면 user 근거로 저장한다', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'user-id' } });
    mockMatchContext({
      componentId: 'component-id',
      projectId: 'project-id',
      projectSlug: 'LinkVault',
      repository: null,
      resourceId: 'resource-id',
      externalId: 'ktgo/linkvault',
      resourceName: 'linkvault',
    });

    await confirmResourceLink(emptyState, linkFormData());

    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        linkedBy: 'user',
      }),
    );
    expect(mocks.values).not.toHaveBeenCalledWith(
      expect.objectContaining({
        linkedBy: 'suggested',
      }),
    );
  });

  it('사람이 직접 고른 비일치 자원은 user 근거로 저장한다', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'user-id' } });
    mockMatchContext({
      componentId: 'component-id',
      projectId: 'project-id',
      projectSlug: 'work',
      repository: null,
      resourceId: 'resource-id',
      externalId: 'ktgo/workwiki',
      resourceName: 'workwiki',
    });

    await confirmResourceLink(emptyState, linkFormData());

    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({ linkedBy: 'user' }),
    );
  });

  it('이미 같은 구성요소에 연결된 자원은 읽을 수 있는 한국어 오류를 돌려준다', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'user-id' } });
    mockMatchContext({
      componentId: 'component-id',
      projectId: 'project-id',
      projectSlug: 'workwiki',
      repository: 'ktgo/workwiki',
      resourceId: 'resource-id',
      externalId: 'ktgo/workwiki',
      resourceName: 'workwiki',
    });
    mocks.returning.mockResolvedValueOnce([]);

    const result = await confirmResourceLink(emptyState, linkFormData());

    expect(result).toEqual({
      status: 'error',
      message: '이 자원은 이미 선택한 구성요소에 연결되어 있습니다.',
    });
  });
});

describe('자원 연결 해제 Server Action', () => {
  it('세션이 없으면 DB 조회와 삭제 전에 즉시 거부한다', async () => {
    const formData = new FormData();
    formData.set('linkId', 'link-id');

    await expect(removeResourceLink(formData)).rejects.toThrow(/인증/);

    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it('component_resources 연결 행을 실제로 삭제한다', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'user-id' } });
    const deleteReturning = vi.fn().mockResolvedValue([
      { componentId: 'component-id' },
    ]);
    const deleteWhere = vi.fn().mockReturnValue({
      returning: deleteReturning,
    });
    mocks.delete.mockReturnValue({ where: deleteWhere });
    mocks.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([{ projectSlug: 'workwiki' }]),
        }),
      }),
    });
    const formData = new FormData();
    formData.set('linkId', 'link-id');

    await removeResourceLink(formData);

    expect(mocks.delete).toHaveBeenCalledTimes(1);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
  });
});
