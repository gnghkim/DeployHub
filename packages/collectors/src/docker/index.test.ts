import { beforeEach, describe, expect, it, vi } from 'vitest';
import inspect from '../../test/fixtures/docker-inspect.json';
import { createDockerCollector } from './index';

type TestResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

const fetchMock = vi.fn<
  (input: string, init: { method: 'GET' }) => Promise<TestResponse>
>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

function response(
  value: unknown,
  status = 200,
): TestResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(value),
    text: vi.fn().mockResolvedValue(
      typeof value === 'string' ? value : JSON.stringify(value),
    ),
  };
}

describe('createDockerCollector', () => {
  it('collects resources and deployments from one bounded inspect scan', async () => {
    fetchMock
      .mockResolvedValueOnce(response([{ Id: inspect.Id }]))
      .mockResolvedValueOnce(response(inspect));
    const collector = createDockerCollector('http://socket-proxy:2375/');

    const resources = await collector.listResources();
    const deployments = await collector.listDeployments();

    expect(resources).toHaveLength(1);
    expect(resources[0]?.externalId).toBe(inspect.Id);
    expect(deployments).toEqual([{
      resourceExternalId: inspect.Id,
      externalDeploymentId: inspect.Id,
      environment: 'unknown',
      status: 'running',
      imageName: 'postgres:17-alpine',
      startedAt: '2026-07-26T10:00:00.000Z',
      metadata: {},
    }]);
    expect(fetchMock.mock.calls.map(([input]) => input)).toEqual([
      'http://socket-proxy:2375/containers/json?all=1',
      `http://socket-proxy:2375/containers/${inspect.Id}/json`,
    ]);
  });

  it('collects CPU and memory snapshots without retaining the stats body', async () => {
    fetchMock
      .mockResolvedValueOnce(response([{ Id: inspect.Id }]))
      .mockResolvedValueOnce(response(inspect))
      .mockResolvedValueOnce(response({
        cpu_stats: {
          cpu_usage: { total_usage: 1_100 },
          system_cpu_usage: 10_800,
          online_cpus: 2,
        },
        precpu_stats: {
          cpu_usage: { total_usage: 1_000 },
          system_cpu_usage: 10_000,
        },
        memory_stats: {
          usage: 4096,
          secretFutureField: 'STATS_SECRET_SHOULD_NOT_APPEAR',
        },
      }));
    const collector = createDockerCollector('http://socket-proxy:2375');

    const snapshots = await collector.listSnapshots();

    expect(snapshots).toEqual([{
      resourceExternalId: inspect.Id,
      cpuPct: 25,
      memBytes: 4096,
      restartCount: 0,
    }]);
    expect(JSON.stringify(snapshots)).not.toContain(
      'STATS_SECRET_SHOULD_NOT_APPEAR',
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      `http://socket-proxy:2375/containers/${inspect.Id}/stats?stream=false`,
      { method: 'GET' },
    );
  });

  it('fails the whole scan before inspect requests when the cap is exceeded', async () => {
    const containers = Array.from(
      { length: 257 },
      (_, index) => ({ Id: `container-${index}` }),
    );
    fetchMock.mockResolvedValueOnce(response(containers));

    await expect(
      createDockerCollector(
        'http://socket-proxy:2375',
      ).listResources(),
    ).rejects.toThrow(
      'Docker 컨테이너 수가 수집 상한을 초과했습니다. (컨테이너 257건, 상한 256건)',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a successful ping without exposing the base URL', async () => {
    fetchMock.mockResolvedValueOnce(response('OK'));

    const result = await createDockerCollector(
      'http://socket-proxy:2375',
    ).testConnection();

    expect(result).toEqual({ ok: true, account: 'docker' });
    expect(JSON.stringify(result)).not.toContain('socket-proxy');
  });

  it('reports only status and container count for inspect failures', async () => {
    const baseUrl = 'http://user:DOCKER_URL_SECRET@socket-proxy:2375';
    fetchMock
      .mockResolvedValueOnce(response([{ Id: inspect.Id }]))
      .mockResolvedValueOnce(response({
        message: 'DOCKER_BODY_SECRET',
      }, 503));

    try {
      await createDockerCollector(baseUrl).listResources();
      throw new Error('expected Docker collection to fail');
    } catch (error) {
      expect(String(error)).toContain(
        'Docker API 요청에 실패했습니다. (HTTP 503, 컨테이너 1건)',
      );
      expect(String(error)).not.toContain(baseUrl);
      expect(String(error)).not.toContain('DOCKER_URL_SECRET');
      expect(String(error)).not.toContain('DOCKER_BODY_SECRET');
      expect(String(error)).not.toContain(inspect.Id);
    }
  });
});
