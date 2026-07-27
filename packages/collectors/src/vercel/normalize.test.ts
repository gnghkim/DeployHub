import { describe, expect, it } from 'vitest';
import deployment from '../../test/fixtures/vercel-deployment.json';
import env from '../../test/fixtures/vercel-env.json';
import project from '../../test/fixtures/vercel-project.json';
import {
  normalizeVercelDeployment,
  normalizeVercelProject,
} from './normalize';

const metadataKeys = [
  'createdAt',
  'envVars',
  'framework',
  'gitRepository',
  'nodeVersion',
  'productionDomain',
  'updatedAt',
];
const secretEnvValue = env[0]!.value;

describe('Vercel normalization', () => {
  it('normalizes the project identity and resource type', () => {
    const resource = normalizeVercelProject(project, env);

    expect(resource).toMatchObject({
      provider: 'vercel',
      externalId: project.id,
      resourceType: 'vercel_project',
      name: project.name,
      status: 'active',
    });
    expect(() => new Date(resource.observedAt).toISOString()).not.toThrow();
  });

  it('normalizes the project metadata fields', () => {
    const resource = normalizeVercelProject(project, env);

    expect(resource.url).toBe('https://deployhub.example.com');
    expect(resource.metadata).toMatchObject({
      framework: 'nextjs',
      gitRepository: 'deployhub/deployhub',
      productionDomain: 'deployhub.example.com',
      nodeVersion: '22.x',
      createdAt: '2026-07-23T22:00:00.000Z',
      updatedAt: '2026-07-24T22:00:00.000Z',
    });
  });

  it('keeps only allowlisted environment fields and sorts targets', () => {
    const resource = normalizeVercelProject(project, env);
    const envVars = resource.metadata.envVars;

    expect(envVars).toEqual([
      {
        key: 'DATABASE_URL',
        target: ['development', 'preview', 'production'],
        type: 'encrypted',
      },
      {
        key: 'NEXT_PUBLIC_APP_URL',
        target: ['production'],
        type: 'plain',
      },
    ]);
    expect(
      (envVars as Array<Record<string, unknown>>).map((entry) =>
        Object.keys(entry).sort()
      ),
    ).toEqual([
      ['key', 'target', 'type'],
      ['key', 'target', 'type'],
    ]);
  });

  it('discards environment values from the complete normalized result', () => {
    const json = JSON.stringify(normalizeVercelProject(project, env));

    expect(json).not.toContain(secretEnvValue);
  });

  it('uses exactly the project metadata allowlist', () => {
    const keys = Object.keys(
      normalizeVercelProject(project, env).metadata,
    ).sort();

    expect(keys).toEqual(metadataKeys);
  });

  it('normalizes deployment status, commit, URL, and timestamps', () => {
    expect(normalizeVercelDeployment(deployment)).toEqual({
      resourceExternalId: project.id,
      externalDeploymentId: deployment.uid,
      environment: 'production',
      status: 'READY',
      commitSha: deployment.meta.githubCommitSha,
      deploymentUrl: `https://${deployment.url}`,
      startedAt: '2026-07-24T22:02:00.000Z',
      completedAt: '2026-07-24T22:03:00.000Z',
      metadata: {},
    });
  });

  it('never includes tokens in normalized results or validation errors', () => {
    const token = 'vercel_normalize_secret_token';
    const result = normalizeVercelProject(
      { ...project, token, futureApiField: token },
      env.map((entry) => ({ ...entry, token })),
    );

    expect(JSON.stringify(result)).not.toContain(token);
    expect(() =>
      normalizeVercelProject({ token }, env),
    ).toThrow('Vercel 프로젝트 응답의 필수 필드가 없습니다.');
    try {
      normalizeVercelProject({ token }, env);
    } catch (error) {
      expect(String(error)).not.toContain(token);
    }
  });
});
