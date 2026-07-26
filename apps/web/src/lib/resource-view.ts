type LastCommit = {
  sha: string;
  message: string;
  committedAt?: string;
};

type LastWorkflowRun = {
  name?: string;
  conclusion?: string | null;
  runAt?: string;
};

export type GithubResourceDetails = {
  lastCommit?: LastCommit;
  lastWorkflowRun?: LastWorkflowRun;
};

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function githubResourceDetails(
  metadataValue: unknown,
): GithubResourceDetails {
  const metadata = record(metadataValue);
  if (!metadata) return {};

  const result: GithubResourceDetails = {};
  const commit = record(metadata.lastCommit);
  if (
    commit
    && typeof commit.sha === 'string'
    && typeof commit.message === 'string'
  ) {
    result.lastCommit = {
      sha: commit.sha,
      message: commit.message,
      committedAt: optionalString(commit.committedAt),
    };
  }

  const workflow = record(metadata.lastWorkflowRun);
  if (workflow) {
    const name = optionalString(workflow.name);
    const conclusion = (
      typeof workflow.conclusion === 'string'
      || workflow.conclusion === null
    )
      ? workflow.conclusion
      : undefined;
    const runAt = optionalString(workflow.runAt);
    if (name !== undefined || conclusion !== undefined || runAt !== undefined) {
      result.lastWorkflowRun = { name, conclusion, runAt };
    }
  }

  return result;
}

export function countRecentCommits(
  resources: { metadata: unknown }[],
  now = new Date(),
): number {
  const since = now.getTime() - (24 * 60 * 60 * 1000);
  return resources.filter((resource) => {
    const committedAt = githubResourceDetails(
      resource.metadata,
    ).lastCommit?.committedAt;
    if (!committedAt) return false;

    const timestamp = Date.parse(committedAt);
    return Number.isFinite(timestamp)
      && timestamp >= since
      && timestamp <= now.getTime();
  }).length;
}
