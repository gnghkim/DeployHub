import { describe, expect, it } from 'vitest';
import {
  countRecentCommits,
  githubResourceDetails,
} from './resource-view';

describe('GitHub 자원 화면 데이터', () => {
  it('최근 커밋과 워크플로 메타데이터를 안전하게 읽는다', () => {
    expect(
      githubResourceDetails({
        lastCommit: {
          sha: 'abc123456789',
          message: 'feat: resource page',
          committedAt: '2026-07-26T03:00:00.000Z',
        },
        lastWorkflowRun: {
          name: 'CI',
          conclusion: 'success',
          runAt: '2026-07-26T03:10:00.000Z',
        },
      }),
    ).toEqual({
      lastCommit: {
        sha: 'abc123456789',
        message: 'feat: resource page',
        committedAt: '2026-07-26T03:00:00.000Z',
      },
      lastWorkflowRun: {
        name: 'CI',
        conclusion: 'success',
        runAt: '2026-07-26T03:10:00.000Z',
      },
    });
  });

  it('형식이 잘못된 메타데이터는 빈 상세로 처리한다', () => {
    expect(githubResourceDetails(null)).toEqual({});
    expect(
      githubResourceDetails({
        lastCommit: { sha: 123 },
        lastWorkflowRun: 'success',
      }),
    ).toEqual({});
  });

  it('현재 시각 기준 24시간 안의 커밋만 센다', () => {
    const now = new Date('2026-07-26T04:00:00.000Z');
    const resources = [
      {
        metadata: {
          lastCommit: {
            sha: 'new',
            message: 'new',
            committedAt: '2026-07-25T05:00:00.000Z',
          },
        },
      },
      {
        metadata: {
          lastCommit: {
            sha: 'old',
            message: 'old',
            committedAt: '2026-07-25T03:59:59.000Z',
          },
        },
      },
      { metadata: {} },
    ];

    expect(countRecentCommits(resources, now)).toBe(1);
  });
});
