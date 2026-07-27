import type {
  ExternalDeployment,
  ExternalResource,
  VercelCollector,
} from '../types';
import {
  normalizeVercelDeployment,
  normalizeVercelProject,
  type VercelEnvironmentVariable,
} from './normalize';

const API_URL = 'https://api.vercel.com';
const CONNECTION_ERROR = 'Vercel 연결을 확인하지 못했습니다.';
const RESPONSE_ERROR = 'Vercel API 응답 형식이 올바르지 않습니다.';
const DETAIL_CONCURRENCY = 4;
const DEPLOYMENT_PAGE_SIZE = 20;

type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

type FetchImplementation = (
  input: string,
  init: { headers: Record<string, string> },
) => Promise<FetchResponse>;

class VercelHttpError extends Error {
  constructor(readonly status: number) {
    super(`Vercel API 요청에 실패했습니다. (HTTP ${status})`);
  }
}

function statusSuffix(error: unknown): string {
  return error instanceof VercelHttpError
    ? ` (HTTP ${error.status})`
    : '';
}

function responseArray<T>(value: unknown, key: string): T[] {
  if (typeof value !== 'object' || value === null) {
    throw new Error(RESPONSE_ERROR);
  }
  const rows = (value as Record<string, unknown>)[key];
  if (!Array.isArray(rows)) throw new Error(RESPONSE_ERROR);
  return rows as T[];
}

function paginationNext(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) {
    throw new Error(RESPONSE_ERROR);
  }
  const pagination = (value as Record<string, unknown>).pagination;
  if (pagination === undefined) return undefined;
  if (
    typeof pagination !== 'object'
    || pagination === null
    || Array.isArray(pagination)
  ) {
    throw new Error(RESPONSE_ERROR);
  }
  const next = (pagination as Record<string, unknown>).next;
  if (next === undefined || next === null) return undefined;
  if (typeof next !== 'number' && typeof next !== 'string') {
    throw new Error(RESPONSE_ERROR);
  }
  return String(next);
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

export function createVercelCollector(
  token: string,
  teamId?: string,
): VercelCollector {
  async function request(
    pathname: string,
    query: Record<string, string> = {},
  ): Promise<unknown> {
    const queryEntries = Object.entries(query);
    if (teamId !== undefined) queryEntries.push(['teamId', teamId]);
    const queryString = queryEntries
      .map(([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
      )
      .join('&');
    const url = `${API_URL}${pathname}${
      queryString === '' ? '' : `?${queryString}`
    }`;

    const fetchImplementation = (
      globalThis as { fetch?: FetchImplementation }
    ).fetch;
    if (fetchImplementation === undefined) {
      throw new Error('Vercel API 요청을 실행할 수 없습니다.');
    }
    let response: FetchResponse;
    try {
      response = await fetchImplementation(url, {
        headers: { authorization: `Bearer ${token}` },
      });
    } catch {
      throw new Error('Vercel API 요청에 실패했습니다.');
    }
    if (!response.ok) throw new VercelHttpError(response.status);
    try {
      return await response.json();
    } catch {
      throw new Error(RESPONSE_ERROR);
    }
  }

  async function listProjects(): Promise<unknown[]> {
    const projects: unknown[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const response = await request(
        '/v9/projects',
        cursor === undefined ? {} : { from: cursor },
      );
      projects.push(...responseArray(response, 'projects'));
      cursor = paginationNext(response);
      if (cursor !== undefined && cursors.has(cursor)) {
        throw new Error(RESPONSE_ERROR);
      }
      if (cursor !== undefined) cursors.add(cursor);
    } while (cursor !== undefined);
    return projects;
  }

  // 프로젝트 목록과 달리 배포는 페이지를 넘기지 않는다. Vercel 은 최신순
  // 으로 주므로 최근 한 페이지면 "최종 배포" 를 아는 데 충분하다.
  //
  // 끝까지 훑으면 6시간마다 모든 프로젝트의 전체 배포 이력을 다시 받아
  // 한 트랜잭션에서 upsert 하게 된다. 활발한 프로젝트는 배포가 수천 건
  // 이라 요청 수와 트랜잭션 크기가 시간이 갈수록 늘기만 한다.
  //
  // 이력이 잘리지도 않는다. deployments 는 (provider, external_deployment_id)
  // 로 upsert 하므로 이전 동기화에서 본 배포는 DB 에 그대로 남는다.
  // 매번 최근 것만 받아도 DB 안에서는 이력이 쌓인다.
  async function listProjectDeployments(
    projectId: string,
  ): Promise<unknown[]> {
    const response = await request('/v6/deployments', {
      projectId,
      limit: String(DEPLOYMENT_PAGE_SIZE),
    });
    return responseArray(response, 'deployments');
  }

  return {
    provider: 'vercel',

    async testConnection() {
      try {
        await listProjects();
        return {
          ok: true,
          account: teamId ?? 'vercel',
        };
      } catch (error) {
        return {
          ok: false,
          error: `${CONNECTION_ERROR}${statusSuffix(error)}`,
        };
      }
    },

    async listResources(): Promise<ExternalResource[]> {
      const projects = await listProjects();
      return mapWithConcurrency(
        projects,
        DETAIL_CONCURRENCY,
        async (project) => {
          const projectId = typeof project === 'object' && project !== null
            ? (project as Record<string, unknown>).id
            : undefined;
          if (
            typeof projectId !== 'string'
          ) {
            throw new Error(RESPONSE_ERROR);
          }
          const envVars = responseArray<VercelEnvironmentVariable>(
            await request(
              `/v9/projects/${encodeURIComponent(projectId)}/env`,
            ),
            'envs',
          );
          return normalizeVercelProject(project, envVars);
        },
      );
    },

    async listDeployments(): Promise<ExternalDeployment[]> {
      const projects = await listProjects();
      const deployments = await mapWithConcurrency(
        projects,
        DETAIL_CONCURRENCY,
        async (project) => {
          const projectId = typeof project === 'object' && project !== null
            ? (project as Record<string, unknown>).id
            : undefined;
          if (
            typeof projectId !== 'string'
          ) {
            throw new Error(RESPONSE_ERROR);
          }
          return listProjectDeployments(projectId);
        },
      );
      return deployments.flat().map(normalizeVercelDeployment);
    },
  };
}

export {
  normalizeVercelDeployment,
  normalizeVercelProject,
} from './normalize';
export type { VercelEnvironmentVariable } from './normalize';
