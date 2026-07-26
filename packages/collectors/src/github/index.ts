import { Octokit } from '@octokit/rest';
import type { ExternalResource, ProviderCollector } from '../types';
import { normalizeRepository, type RepoExtra } from './normalize';

const CONNECTION_ERROR = 'GitHub 연결을 확인하지 못했습니다.';
const DETAIL_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  fn: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await fn(values[current]!);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(limit, values.length) },
      async () => worker(),
    ),
  );
  return results;
}

export function createGithubCollector(token: string): ProviderCollector {
  const octokit = new Octokit({ auth: token });

  return {
    provider: 'github',

    async testConnection() {
      try {
        const { data } = await octokit.rest.users.getAuthenticated();
        return { ok: true, account: data.login };
      } catch {
        return { ok: false, error: CONNECTION_ERROR };
      }
    },

    async listResources(): Promise<ExternalResource[]> {
      const repositories = await octokit.paginate(
        octokit.rest.repos.listForAuthenticatedUser,
        {
          affiliation: 'owner,collaborator,organization_member',
          per_page: 100,
        },
      );

      return mapWithConcurrency(
        repositories,
        DETAIL_CONCURRENCY,
        async (repository) => {
          const [owner = '', repo = ''] = repository.full_name.split('/', 2);
          const [languagesResponse, commitsResponse, runsResponse] =
            await Promise.all([
              octokit.rest.repos.listLanguages({ owner, repo }),
              octokit.rest.repos.listCommits({ owner, repo, per_page: 1 }),
              octokit.rest.actions.listWorkflowRunsForRepo({
                owner,
                repo,
                per_page: 1,
              }),
            ]);

          const commit = commitsResponse.data[0];
          const run = runsResponse.data.workflow_runs[0];
          const extra: RepoExtra = {
            languages: languagesResponse.data,
            lastCommit: commit
              ? {
                  sha: commit.sha,
                  message: commit.commit.message,
                  committedAt:
                    commit.commit.committer?.date
                    ?? commit.commit.author?.date
                    ?? undefined,
                }
              : undefined,
            lastWorkflowRun: run
              ? {
                  name: run.name ?? undefined,
                  conclusion: run.conclusion,
                  runAt:
                    run.run_started_at
                    ?? run.created_at
                    ?? undefined,
                }
              : undefined,
          };
          return normalizeRepository(repository, extra);
        },
      );
    },
  };
}

export { normalizeRepository } from './normalize';
export type { RepoExtra } from './normalize';
