import type {
  DeploymentCollector,
  ExternalDeployment,
  ExternalResource,
} from '../types';
import {
  normalizeDockerContainer,
  normalizeDockerDeployment,
} from './normalize';

const MAX_CONTAINER_COUNT = 256;
const DETAIL_CONCURRENCY = 8;
const REQUEST_ERROR = 'Docker API 요청에 실패했습니다.';
const RESPONSE_ERROR = 'Docker API 응답 형식이 올바르지 않습니다.';

type UnknownRecord = Record<string, unknown>;

type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

type FetchImplementation = (
  input: string,
  init: { method: 'GET' },
) => Promise<FetchResponse>;

type InspectedContainer = {
  inspect: unknown;
  resource: ExternalResource;
};

export type DockerContainerSnapshot = {
  resourceExternalId: string;
  cpuPct: number;
  memBytes: number;
  restartCount: number;
};

export interface DockerCollector extends DeploymentCollector {
  listSnapshots(): Promise<DockerContainerSnapshot[]>;
}

class DockerHttpError extends Error {
  constructor(
    readonly status: number,
    readonly containerCount?: number,
  ) {
    super(
      `${REQUEST_ERROR} (HTTP ${status}${
        containerCount === undefined
          ? ''
          : `, 컨테이너 ${containerCount}건`
      })`,
    );
  }
}

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object'
      && value !== null
      && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function containerCountSuffix(containerCount?: number): string {
  return containerCount === undefined
    ? ''
    : ` (컨테이너 ${containerCount}건)`;
}

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

function requiredNumber(
  value: unknown,
  containerCount: number,
): number {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || value < 0
  ) {
    throw new Error(`${RESPONSE_ERROR}${containerCountSuffix(containerCount)}`);
  }
  return value;
}

function normalizeSnapshot(
  statsValue: unknown,
  resource: ExternalResource,
  containerCount: number,
): DockerContainerSnapshot {
  const stats = asRecord(statsValue);
  const currentCpu = asRecord(stats.cpu_stats);
  const currentUsage = asRecord(currentCpu.cpu_usage);
  const previousCpu = asRecord(stats.precpu_stats);
  const previousUsage = asRecord(previousCpu.cpu_usage);
  const memory = asRecord(stats.memory_stats);
  const totalUsage = requiredNumber(
    currentUsage.total_usage,
    containerCount,
  );
  const previousTotalUsage = requiredNumber(
    previousUsage.total_usage,
    containerCount,
  );
  const systemUsage = requiredNumber(
    currentCpu.system_cpu_usage,
    containerCount,
  );
  const previousSystemUsage = requiredNumber(
    previousCpu.system_cpu_usage,
    containerCount,
  );
  const onlineCpus = requiredNumber(
    currentCpu.online_cpus,
    containerCount,
  );
  const cpuDelta = totalUsage - previousTotalUsage;
  const systemDelta = systemUsage - previousSystemUsage;
  const cpuPct = cpuDelta > 0 && systemDelta > 0
    ? cpuDelta / systemDelta * onlineCpus * 100
    : 0;
  const restartCount = resource.metadata.restartCount;

  return {
    resourceExternalId: resource.externalId,
    cpuPct,
    memBytes: requiredNumber(memory.usage, containerCount),
    restartCount: typeof restartCount === 'number' ? restartCount : 0,
  };
}

export function createDockerCollector(baseUrl: string): DockerCollector {
  const apiUrl = baseUrl.replace(/\/+$/, '');

  async function request(
    pathname: string,
    containerCount?: number,
  ): Promise<FetchResponse> {
    const fetchImplementation = (
      globalThis as { fetch?: FetchImplementation }
    ).fetch;
    if (fetchImplementation === undefined) {
      throw new Error(
        `${REQUEST_ERROR}${containerCountSuffix(containerCount)}`,
      );
    }

    let response: FetchResponse;
    try {
      response = await fetchImplementation(`${apiUrl}${pathname}`, {
        method: 'GET',
      });
    } catch {
      throw new Error(
        `${REQUEST_ERROR}${containerCountSuffix(containerCount)}`,
      );
    }
    if (!response.ok) {
      throw new DockerHttpError(response.status, containerCount);
    }
    return response;
  }

  async function requestJson(
    pathname: string,
    containerCount?: number,
  ): Promise<unknown> {
    const response = await request(pathname, containerCount);
    try {
      return await response.json();
    } catch {
      throw new Error(
        `${RESPONSE_ERROR}${containerCountSuffix(containerCount)}`,
      );
    }
  }

  async function scanContainers(): Promise<InspectedContainer[]> {
    const list = await requestJson('/containers/json?all=1');
    if (!Array.isArray(list)) throw new Error(RESPONSE_ERROR);
    if (list.length > MAX_CONTAINER_COUNT) {
      throw new Error(
        'Docker 컨테이너 수가 수집 상한을 초과했습니다. '
        + `(컨테이너 ${list.length}건, 상한 ${MAX_CONTAINER_COUNT}건)`,
      );
    }

    const ids = list.map((entry) => asRecord(entry).Id);
    if (ids.some((id) => typeof id !== 'string' || id === '')) {
      throw new Error(
        `${RESPONSE_ERROR}${containerCountSuffix(list.length)}`,
      );
    }

    return mapWithConcurrency(
      ids as string[],
      DETAIL_CONCURRENCY,
      async (id) => {
        const inspect = await requestJson(
          `/containers/${encodeURIComponent(id)}/json`,
          list.length,
        );
        return {
          inspect,
          resource: normalizeDockerContainer(inspect),
        };
      },
    );
  }

  let scanPromise: Promise<InspectedContainer[]> | undefined;
  function scan(): Promise<InspectedContainer[]> {
    scanPromise ??= scanContainers();
    return scanPromise;
  }

  return {
    provider: 'docker',

    async testConnection() {
      try {
        const response = await request('/_ping');
        await response.text();
        return { ok: true, account: 'docker' };
      } catch (error) {
        const status = error instanceof DockerHttpError
          ? ` (HTTP ${error.status})`
          : '';
        return {
          ok: false,
          error: `Docker 연결을 확인하지 못했습니다.${status}`,
        };
      }
    },

    async listResources(): Promise<ExternalResource[]> {
      return (await scan()).map(({ resource }) => resource);
    },

    async listDeployments(): Promise<ExternalDeployment[]> {
      return (await scan())
        .filter(({ resource }) => resource.status === 'running')
        .map(({ inspect }) => normalizeDockerDeployment(inspect));
    },

    async listSnapshots(): Promise<DockerContainerSnapshot[]> {
      const containers = (await scan()).filter(
        ({ resource }) => resource.status === 'running',
      );
      return mapWithConcurrency(
        containers,
        DETAIL_CONCURRENCY,
        async ({ resource }) => normalizeSnapshot(
          await requestJson(
            `/containers/${
              encodeURIComponent(resource.externalId)
            }/stats?stream=false`,
            containers.length,
          ),
          resource,
          containers.length,
        ),
      );
    },
  };
}

export {
  normalizeDockerContainer,
  normalizeDockerDeployment,
} from './normalize';
