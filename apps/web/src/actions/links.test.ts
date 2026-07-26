import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  onConflictDoUpdate: vi.fn(),
}));

vi.mock('../auth/config', () => ({ auth: mocks.auth }));
vi.mock('../lib/db', () => ({
  db: {
    select: mocks.select,
    insert: mocks.insert,
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { confirmResourceLink } from './links';

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
    onConflictDoUpdate: mocks.onConflictDoUpdate,
  });
  mocks.onConflictDoUpdate.mockResolvedValue(undefined);
});

describe('자원 연결 Server Action', () => {
  it('세션이 없으면 DB 조회 전에 즉시 거부한다', async () => {
    await expect(
      confirmResourceLink(linkFormData()),
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

    await confirmResourceLink(linkFormData());

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

    await confirmResourceLink(linkFormData());

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

  it('부분 일치 후보는 저장하지 않는다', async () => {
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

    await expect(
      confirmResourceLink(linkFormData()),
    ).rejects.toThrow(/일치/);
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
