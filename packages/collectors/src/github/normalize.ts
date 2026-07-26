import type { ExternalResource } from '../types';

type GithubRepository = {
  full_name: string;
  name: string;
  html_url: string;
  private?: boolean;
  description?: string | null;
  default_branch?: string;
  topics?: string[];
  archived?: boolean;
  pushed_at?: string | null;
  language?: string | null;
};

export type RepoExtra = {
  languages: Record<string, number>;
  lastCommit?: {
    sha: string;
    message: string;
    committedAt?: string;
  };
  lastWorkflowRun?: {
    name?: string;
    conclusion?: string | null;
    runAt?: string;
  };
};

function asRepository(value: unknown): GithubRepository {
  if (typeof value !== 'object' || value === null) {
    throw new Error('GitHub 저장소 응답 형식이 올바르지 않습니다.');
  }

  const repo = value as Partial<GithubRepository>;
  if (
    typeof repo.full_name !== 'string'
    || typeof repo.name !== 'string'
    || typeof repo.html_url !== 'string'
  ) {
    throw new Error('GitHub 저장소 응답의 필수 필드가 없습니다.');
  }
  return repo as GithubRepository;
}

function sanitizeMetadataValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (/authorization/i.test(value)) return '[REDACTED]';
    return value
      .replace(/github[_]pat[_][A-Za-z0-9_]+/gi, '[REDACTED]')
      .replace(/ghp[_][A-Za-z0-9]+/gi, '[REDACTED]');
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeMetadataValue);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/authorization|token|secret/i.test(key))
        .map(([key, nested]) => [key, sanitizeMetadataValue(nested)]),
    );
  }
  return value;
}

export function normalizeRepository(
  repoValue: unknown,
  extra: RepoExtra,
): ExternalResource {
  const repo = asRepository(repoValue);
  const metadata = sanitizeMetadataValue({
    private: repo.private ?? false,
    description: repo.description ?? null,
    defaultBranch: repo.default_branch,
    topics: repo.topics ?? [],
    primaryLanguage: repo.language ?? null,
    languages: extra.languages,
    pushedAt: repo.pushed_at ?? null,
    lastCommit: extra.lastCommit,
    lastWorkflowRun: extra.lastWorkflowRun,
  }) as Record<string, unknown>;
  return {
    provider: 'github',
    externalId: repo.full_name,
    resourceType: 'github_repository',
    name: repo.name,
    status: repo.archived === true ? 'archived' : 'active',
    url: repo.html_url,
    metadata,
    observedAt: new Date().toISOString(),
  };
}
