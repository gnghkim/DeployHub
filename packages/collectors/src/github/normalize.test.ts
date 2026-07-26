import { describe, expect, it } from 'vitest';
import repo from '../../test/fixtures/repo.json';
import { normalizeRepository } from './normalize';

const extra = {
  languages: { TypeScript: 12345, CSS: 678 },
  lastCommit: {
    sha: 'a41d82c',
    message: 'fix: 배포 스크립트',
    committedAt: '2026-07-20T10:00:00Z',
  },
  lastWorkflowRun: {
    name: 'CI',
    conclusion: 'success',
    runAt: '2026-07-20T10:05:00Z',
  },
};

describe('normalizeRepository', () => {
  it('공통 필드를 정규화한다', () => {
    const resource = normalizeRepository(repo, extra);
    expect(resource.provider).toBe('github');
    expect(resource.resourceType).toBe('github_repository');
    expect(resource.externalId).toBe(repo.full_name);
    expect(resource.name).toBe(repo.name);
    expect(resource.url).toBe(repo.html_url);
  });

  it('archived 저장소의 status 를 archived 로 표시한다', () => {
    expect(
      normalizeRepository({ ...repo, archived: true }, extra).status,
    ).toBe('archived');
    expect(
      normalizeRepository({ ...repo, archived: false }, extra).status,
    ).toBe('active');
  });

  it('커밋과 워크플로 결과를 metadata 에 담는다', () => {
    const metadata = normalizeRepository(repo, extra).metadata;
    expect(metadata.lastCommit).toMatchObject({ sha: 'a41d82c' });
    expect(metadata.lastWorkflowRun).toMatchObject({ conclusion: 'success' });
    expect(metadata.defaultBranch).toBe(repo.default_branch);
  });

  it('observedAt 이 ISO 8601 문자열이다', () => {
    expect(() =>
      new Date(normalizeRepository(repo, extra).observedAt).toISOString(),
    ).not.toThrow();
  });

  it('토큰이나 비밀값을 metadata 에 넣지 않는다', () => {
    const json = JSON.stringify(
      normalizeRepository(
        {
          ...repo,
          description: 'leaked ghp_metadataSecret',
          topics: ['Authorization: Bearer metadata-secret'],
        },
        {
          ...extra,
          lastCommit: {
            ...extra.lastCommit,
            message: 'leaked github_pat_metadataSecret',
          },
        },
      ),
    );
    expect(json).not.toMatch(/ghp_|github_pat_|Authorization/i);
  });

  it('워크플로 이력이 없어도 실패하지 않는다', () => {
    const resource = normalizeRepository(repo, {
      ...extra,
      lastWorkflowRun: undefined,
    });
    expect(resource.metadata.lastWorkflowRun).toBeUndefined();
  });
});
