import { execFile } from 'node:child_process';
import { cp, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { detectProject } from './index';

const fixturesDir = fileURLToPath(
  new URL('../../test/fixtures/', import.meta.url),
);
const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function componentSummary(
  result: Awaited<ReturnType<typeof detectProject>>,
  name: string,
) {
  const component = result.manifest.spec?.components.find(
    (candidate) => candidate.name === name,
  );
  expect(component).toBeDefined();
  return component;
}

async function fixtureCopy(name: string): Promise<string> {
  const container = await mkdtemp(join(tmpdir(), 'deployhub-fixture-'));
  temporaryDirectories.push(container);
  const rootDir = join(container, name);
  await cp(join(fixturesDir, name), rootDir, { recursive: true });
  return rootDir;
}

describe('detectProject', () => {
  it('detects Next.js monorepo components and a Prisma database', async () => {
    const result = await detectProject(
      await fixtureCopy('nextjs-monorepo'),
    );

    expect(result.manifest.spec?.components.map(({ name }) => name)).toEqual([
      'web',
      'worker',
      'database',
    ]);
    expect(componentSummary(result, 'web')).toMatchObject({
      name: 'web',
      type: 'frontend',
      framework: 'nextjs',
      runtime: 'nodejs',
      language: 'typescript',
      path: 'apps/web',
    });
    expect(componentSummary(result, 'worker')).toMatchObject({
      name: 'worker',
      type: 'worker',
      runtime: 'nodejs',
      path: 'apps/worker',
    });
    expect(componentSummary(result, 'database')).toMatchObject({
      name: 'database',
      type: 'database',
      framework: 'prisma',
      path: 'prisma/schema.prisma',
    });
  });

  it('records detected evidence, Compose candidates, and unknown fields', async () => {
    const result = await detectProject(
      await fixtureCopy('nextjs-monorepo'),
    );

    expect(result.fieldSources.web?.framework).toEqual({
      origin: 'detected',
      evidence: 'next@16.2.12',
      source: 'apps/web/package.json',
    });
    expect(result.fieldSources.web?.type?.evidence).toContain('compose.yaml');
    expect(result.fieldSources.web?.criticality).toEqual({
      origin: 'unknown',
    });
    expect(result.fieldSources.worker?.language).toEqual({
      origin: 'unknown',
    });
    expect(result.manifest.metadata).toEqual({
      name: 'nextjs-monorepo',
      slug: 'nextjs-monorepo',
    });
    expect(result.fieldSources['$project']?.['metadata.name']).toEqual({
      origin: 'inferred',
      evidence: 'directory name=nextjs-monorepo',
      source: '.',
    });
    expect(result.fieldSources['$project']?.['metadata.slug']).toEqual({
      origin: 'inferred',
      evidence: 'normalized from name=nextjs-monorepo',
      source: '.',
    });
    expect(result.manifest.spec?.repository).toBeUndefined();
  });

  it('detects a FastAPI Python API', async () => {
    const result = await detectProject(await fixtureCopy('python-api'));

    expect(result.manifest.spec?.components.map(({ name }) => name)).toEqual([
      'api',
    ]);
    expect(componentSummary(result, 'api')).toMatchObject({
      name: 'api',
      type: 'api',
      framework: 'fastapi',
      runtime: 'python',
      language: 'python',
      path: '.',
    });
    expect(result.fieldSources.api?.framework?.evidence).toContain(
      'fastapi==0.116.1',
    );
    expect(result.fieldSources.api?.criticality?.origin).toBe('unknown');
    expect(result.manifest.metadata).toEqual({
      name: 'api',
      slug: 'api',
    });
    expect(result.fieldSources['$project']?.['metadata.name']).toEqual({
      origin: 'detected',
      evidence: 'pyproject.toml [project] name=api',
      source: 'pyproject.toml',
    });
  });

  it('detects a plain Express backend and GitHub Actions', async () => {
    const result = await detectProject(await fixtureCopy('plain-node'));

    expect(result.manifest.spec?.components.map(({ name }) => name)).toEqual([
      'backend',
    ]);
    expect(componentSummary(result, 'backend')).toMatchObject({
      name: 'backend',
      type: 'backend',
      framework: 'express',
      runtime: 'nodejs',
      path: '.',
    });
    expect(result.notes).toContain(
      'Detected GitHub Actions workflow: .github/workflows/ci.yml',
    );
    expect(result.fieldSources.backend?.language).toEqual({
      origin: 'unknown',
    });
    expect(result.manifest.metadata).toEqual({
      name: 'backend',
      slug: 'backend',
    });
    expect(result.fieldSources['$project']?.['metadata.name']).toEqual({
      origin: 'detected',
      evidence: 'package.json name=backend',
      source: 'package.json',
    });
  });

  it('normalizes a scoped package name into a manifest slug', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'deployhub-metadata-'));
    temporaryDirectories.push(rootDir);
    await writeFile(
      join(rootDir, 'package.json'),
      JSON.stringify({ name: '@scope/My_App' }),
    );

    const result = await detectProject(rootDir);

    expect(result.manifest.metadata).toEqual({
      name: 'My_App',
      slug: 'my-app',
    });
    expect(result.fieldSources['$project']?.['metadata.name']).toEqual({
      origin: 'detected',
      evidence: 'package.json name=@scope/My_App',
      source: 'package.json',
    });
    expect(result.fieldSources['$project']?.['metadata.slug']).toEqual({
      origin: 'detected',
      evidence: 'normalized from name=My_App',
      source: 'package.json',
    });
  });

  it('omits a slug that is still invalid after normalization', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'deployhub-metadata-'));
    temporaryDirectories.push(rootDir);
    await writeFile(
      join(rootDir, 'package.json'),
      JSON.stringify({ name: '___' }),
    );

    const result = await detectProject(rootDir);

    expect(result.manifest.metadata).toEqual({ name: '___' });
    expect(result.fieldSources['$project']?.['metadata.name']?.origin).toBe(
      'detected',
    );
    expect(result.fieldSources['$project']?.['metadata.slug']).toEqual({
      origin: 'unknown',
    });
  });

  it('detects a Poetry project name from pyproject.toml', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'deployhub-poetry-'));
    temporaryDirectories.push(rootDir);
    await writeFile(
      join(rootDir, 'pyproject.toml'),
      '[tool.poetry]\nname = "Poetry_App"\n',
    );

    const result = await detectProject(rootDir);

    expect(result.manifest.metadata).toEqual({
      name: 'Poetry_App',
      slug: 'poetry-app',
    });
    expect(result.fieldSources['$project']?.['metadata.name']).toEqual({
      origin: 'detected',
      evidence: 'pyproject.toml [tool.poetry] name=Poetry_App',
      source: 'pyproject.toml',
    });
  });

  it('never exposes values from .env files', async () => {
    for (const fixture of [
      'nextjs-monorepo',
      'python-api',
      'plain-node',
    ]) {
      const result = await detectProject(await fixtureCopy(fixture));
      expect(JSON.stringify(result)).not.toContain(
        'SHOULD_NOT_APPEAR_abc123',
      );
    }
  });

  it('records only key names declared by .env.example', async () => {
    const result = await detectProject(await fixtureCopy('python-api'));

    expect(result.notes).toContain(
      'Environment keys declared in .env.example: DATABASE_URL, LOG_LEVEL',
    );
    expect(JSON.stringify(result)).not.toContain('info');
  });

  it('detects a GitHub repository slug from the git remote', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'deployhub-detector-'));
    temporaryDirectories.push(rootDir);
    await mkdir(join(rootDir, '.git'), { recursive: true });
    await writeFile(
      join(rootDir, '.git', 'config'),
      [
        '[remote "origin"]',
        '  url = git@github.com:deployhub/example.git',
      ].join('\n'),
    );
    await writeFile(
      join(rootDir, 'package.json'),
      JSON.stringify({
        name: 'backend',
        dependencies: { express: '5.1.0' },
      }),
    );

    const result = await detectProject(rootDir);

    expect(result.manifest.spec?.repository).toEqual({
      provider: 'github',
      slug: 'deployhub/example',
    });
    expect(result.fieldSources['$project']?.['repository.slug']).toEqual({
      origin: 'detected',
      evidence: 'github.com/deployhub/example',
      source: '.git/config',
    });
  });

  it('detects worktree remotes without exposing URL credentials', async () => {
    const container = await mkdtemp(
      join(tmpdir(), 'deployhub-detector-worktree-'),
    );
    temporaryDirectories.push(container);
    const repositoryDir = join(container, 'repository');
    const worktreeDir = join(container, 'worktree');
    await execFileAsync('git', ['init', repositoryDir]);
    await execFileAsync('git', [
      '-C',
      repositoryDir,
      'config',
      'user.email',
      'test@example.invalid',
    ]);
    await execFileAsync('git', [
      '-C',
      repositoryDir,
      'config',
      'user.name',
      'DeployHub Test',
    ]);
    await execFileAsync('git', [
      '-C',
      repositoryDir,
      'commit',
      '--allow-empty',
      '-m',
      'initial',
    ]);
    await execFileAsync('git', [
      '-C',
      repositoryDir,
      'remote',
      'add',
      'origin',
      'https://secret-token@github.com/deployhub/example.git',
    ]);
    await execFileAsync('git', [
      '-C',
      repositoryDir,
      'worktree',
      'add',
      '-b',
      'detector-test',
      worktreeDir,
    ]);

    const result = await detectProject(worktreeDir);

    expect(result.manifest.spec?.repository).toEqual({
      provider: 'github',
      slug: 'deployhub/example',
    });
    expect(JSON.stringify(result)).not.toContain('secret-token');
    expect(result.fieldSources['$project']?.['repository.slug']).toEqual({
      origin: 'detected',
      evidence: 'github.com/deployhub/example',
      source: 'git remote get-url origin',
    });
  });
});
