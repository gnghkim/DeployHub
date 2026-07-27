import { beforeEach, describe, expect, it, vi } from 'vitest';
import deployment from '../../test/fixtures/vercel-deployment.json';
import env from '../../test/fixtures/vercel-env.json';
import project from '../../test/fixtures/vercel-project.json';
import { createVercelCollector } from './index';

type TestResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

const fetchMock = vi.fn<
  (input: string, init: { headers: Record<string, string> }) =>
    Promise<TestResponse>
>();
const secretEnvValue = env[0]!.value;

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

function jsonResponse(value: unknown, status = 200): TestResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(value),
  };
}

function requestPath(input: string): string {
  return input.replace('https://api.vercel.com', '').split('?', 1)[0] ?? '';
}

function requestQuery(input: string): Array<[string, string]> {
  const query = input.split('?', 2)[1];
  if (query === undefined || query === '') return [];
  return query.split('&').map((part) => {
    const [key = '', value = ''] = part.split('=', 2);
    return [decodeURIComponent(key), decodeURIComponent(value)];
  });
}

describe('createVercelCollector', () => {
  it('lists projects and immediately reduces environment responses', async () => {
    const secondProject = {
      ...project,
      id: 'prj_deployhub_worker',
      name: 'deployhub-worker',
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        projects: [project],
        pagination: { next: 1784930400000 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        projects: [secondProject],
        pagination: { next: null },
      }))
      .mockResolvedValueOnce(jsonResponse({ envs: env }))
      .mockResolvedValueOnce(jsonResponse({ envs: [] }));

    const resources = await createVercelCollector(
      'vercel_api_secret',
      'team_deployhub',
    ).listResources();

    expect(resources).toHaveLength(2);
    expect(JSON.stringify(resources)).not.toContain(secretEnvValue);
    const urls = fetchMock.mock.calls.map(([input]) => input);
    expect(urls.map(requestPath)).toEqual([
      '/v9/projects',
      '/v9/projects',
      `/v9/projects/${project.id}/env`,
      `/v9/projects/${secondProject.id}/env`,
    ]);
    expect(urls.map((url) =>
      requestQuery(url).map(([key]) => key).sort()
    )).toEqual([
      ['teamId'],
      ['from', 'teamId'],
      ['teamId'],
      ['teamId'],
    ]);
  });

  it('lists deployments for every Vercel project', async () => {
    const secondDeployment = {
      ...deployment,
      uid: 'dpl_deployhub_002',
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        projects: [project],
        pagination: { next: null },
      }))
      .mockResolvedValueOnce(jsonResponse({
        deployments: [deployment],
        pagination: { next: 1784930500000 },
      }))
      .mockResolvedValueOnce(jsonResponse({
        deployments: [secondDeployment],
        pagination: { next: null },
      }));

    const deployments = await createVercelCollector(
      'vercel_api_secret',
    ).listDeployments();

    expect(deployments).toHaveLength(2);
    expect(deployments[0]).toMatchObject({
      resourceExternalId: project.id,
      externalDeploymentId: deployment.uid,
    });
    const deploymentUrls = fetchMock.mock.calls
      .slice(1)
      .map(([input]) => input);
    expect(deploymentUrls.map(requestPath)).toEqual([
      '/v6/deployments',
      '/v6/deployments',
    ]);
    expect(requestQuery(deploymentUrls[0] ?? '')).toEqual([
      ['projectId', project.id],
    ]);
    expect(requestQuery(deploymentUrls[1] ?? '')).toEqual([
      ['projectId', project.id],
      ['until', '1784930500000'],
    ]);
  });

  it('reports a successful connection without exposing the token', async () => {
    const token = 'vercel_connection_secret';
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ projects: [project] }),
    );

    const result = await createVercelCollector(
      token,
      'team_deployhub',
    ).testConnection();

    expect(result).toEqual({ ok: true, account: 'team_deployhub' });
    expect(JSON.stringify(result)).not.toContain(token);
  });

  it('reports only a safe status-bearing error', async () => {
    const token = 'vercel_failure_secret';
    fetchMock.mockResolvedValue(
      {
        ok: false,
        status: 503,
        json: vi.fn().mockResolvedValue({
          message: `upstream response containing ${token}`,
        }),
      },
    );

    const collector = createVercelCollector(token);
    const connection = await collector.testConnection();

    expect(connection).toEqual({
      ok: false,
      error: 'Vercel 연결을 확인하지 못했습니다. (HTTP 503)',
    });
    expect(JSON.stringify(connection)).not.toContain(token);
    await expect(collector.listResources()).rejects.toThrow(
      'Vercel API 요청에 실패했습니다. (HTTP 503)',
    );
  });

  it('does not expose a token from a network error', async () => {
    const token = 'vercel_network_failure_secret';
    fetchMock.mockRejectedValue(
      new Error(`socket failure containing ${token}`),
    );

    try {
      await createVercelCollector(token).listResources();
      throw new Error('expected the collector request to fail');
    } catch (error) {
      expect(String(error)).toContain('Vercel API 요청에 실패했습니다.');
      expect(String(error)).not.toContain(token);
    }
  });
});
