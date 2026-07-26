import { beforeEach, describe, expect, it, vi } from 'vitest';
import repo from '../../test/fixtures/repo.json';

const octokitMocks = vi.hoisted(() => ({
  getAuthenticated: vi.fn(),
  listForAuthenticatedUser: vi.fn(),
  listLanguages: vi.fn(),
  listCommits: vi.fn(),
  listWorkflowRunsForRepo: vi.fn(),
  paginate: vi.fn(),
}));

vi.mock('@octokit/rest', () => ({
  Octokit: class {
    readonly rest = {
      users: { getAuthenticated: octokitMocks.getAuthenticated },
      repos: {
        listForAuthenticatedUser: octokitMocks.listForAuthenticatedUser,
        listLanguages: octokitMocks.listLanguages,
        listCommits: octokitMocks.listCommits,
      },
      actions: {
        listWorkflowRunsForRepo: octokitMocks.listWorkflowRunsForRepo,
      },
    };

    readonly paginate = octokitMocks.paginate;
  },
}));

import { createGithubCollector } from './index';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createGithubCollector', () => {
  it('연결 성공 시 로그인명을 반환한다', async () => {
    octokitMocks.getAuthenticated.mockResolvedValue({
      data: { login: 'octocat' },
    });

    await expect(
      createGithubCollector('secret-value').testConnection(),
    ).resolves.toEqual({ ok: true, account: 'octocat' });
  });

  it('연결 오류에 토큰을 포함하지 않는다', async () => {
    const token = 'ghp_connectionFailureSecret';
    octokitMocks.getAuthenticated.mockRejectedValue(
      new Error(`Bad credentials: ${token}`),
    );

    const result = await createGithubCollector(token).testConnection();

    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it('저장소와 추가 조회 결과를 정규화한다', async () => {
    octokitMocks.paginate.mockResolvedValue([repo]);
    octokitMocks.listLanguages.mockResolvedValue({
      data: { TypeScript: 12345 },
    });
    octokitMocks.listCommits.mockResolvedValue({
      data: [
        {
          sha: 'abc123',
          commit: {
            message: 'feat: collector',
            committer: { date: '2026-07-20T10:00:00Z' },
          },
        },
      ],
    });
    octokitMocks.listWorkflowRunsForRepo.mockResolvedValue({
      data: {
        workflow_runs: [
          {
            name: 'CI',
            conclusion: 'success',
            run_started_at: '2026-07-20T10:05:00Z',
          },
        ],
      },
    });

    const resources = await createGithubCollector(
      'secret-value',
    ).listResources();

    expect(resources).toHaveLength(1);
    expect(resources[0]).toMatchObject({
      externalId: repo.full_name,
      metadata: {
        languages: { TypeScript: 12345 },
        lastCommit: { sha: 'abc123' },
        lastWorkflowRun: { conclusion: 'success' },
      },
    });
    expect(octokitMocks.paginate).toHaveBeenCalledWith(
      octokitMocks.listForAuthenticatedUser,
      expect.objectContaining({
        affiliation: 'owner,collaborator,organization_member',
      }),
    );
  });
});
