import { execFile } from 'node:child_process';
import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type RepositoryDetection = {
  slug: string;
  evidence: string;
  source: string;
};

function githubSlug(remote: string): string | undefined {
  const match = remote
    .trim()
    .match(
      /github\.com(?::|\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/,
    );
  return match?.[1];
}

export async function detectGitHubRepository(
  rootDir: string,
): Promise<RepositoryDetection | undefined> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', rootDir, 'remote', 'get-url', 'origin'],
      { windowsHide: true },
    );
    const slug = githubSlug(stdout);
    if (slug) {
      return {
        slug,
        evidence: `github.com/${slug}`,
        source: 'git remote get-url origin',
      };
    }
  } catch {
    // Fall back to direct config parsing for lightweight fixture directories.
  }

  const configPath = join(rootDir, '.git', 'config');
  try {
    const config = await readFile(configPath, 'utf8');
    const originSection = config.match(
      /\[remote\s+"origin"\]([\s\S]*?)(?=\n\[|$)/,
    )?.[1];
    const remote = originSection?.match(/^\s*url\s*=\s*(.+)$/m)?.[1]?.trim();
    const slug = remote ? githubSlug(remote) : undefined;
    return slug
      ? {
          slug,
          evidence: `github.com/${slug}`,
          source: '.git/config',
        }
      : undefined;
  } catch {
    return undefined;
  }
}

export async function detectGitHubWorkflows(
  rootDir: string,
): Promise<string[]> {
  const workflowDirectory = join(rootDir, '.github', 'workflows');
  try {
    await access(workflowDirectory);
    return (await readdir(workflowDirectory))
      .filter((name) => /\.ya?ml$/i.test(name))
      .sort()
      .map((name) => `.github/workflows/${name}`);
  } catch {
    return [];
  }
}
