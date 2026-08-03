import type {
  ExternalResource,
  ProviderCollector,
} from '../types';
import { normalizeSupabaseProject } from './normalize';

const API_URL = 'https://api.supabase.com';
const CONNECTION_ERROR = 'Supabase 연결을 확인하지 못했습니다.';
const RESPONSE_ERROR = 'Supabase API 응답 형식이 올바르지 않습니다.';

type FetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

type FetchImplementation = (
  input: string,
  init: { headers: Record<string, string> },
) => Promise<FetchResponse>;

class SupabaseHttpError extends Error {
  constructor(readonly status: number) {
    super(`Supabase API 요청에 실패했습니다. (HTTP ${status})`);
  }
}

function statusSuffix(error: unknown): string {
  return error instanceof SupabaseHttpError
    ? ` (HTTP ${error.status})`
    : '';
}

export function createSupabaseCollector(token: string): ProviderCollector {
  async function listProjects(): Promise<unknown[]> {
    const fetchImplementation = (
      globalThis as { fetch?: FetchImplementation }
    ).fetch;
    if (fetchImplementation === undefined) {
      throw new Error('Supabase API 요청을 실행할 수 없습니다.');
    }

    let response: FetchResponse;
    try {
      response = await fetchImplementation(`${API_URL}/v1/projects`, {
        headers: { authorization: `Bearer ${token}` },
      });
    } catch {
      throw new Error('Supabase API 요청에 실패했습니다.');
    }
    if (!response.ok) throw new SupabaseHttpError(response.status);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new Error(RESPONSE_ERROR);
    }
    if (!Array.isArray(body)) throw new Error(RESPONSE_ERROR);
    return body;
  }

  return {
    provider: 'supabase',

    async testConnection() {
      try {
        await listProjects();
        return { ok: true, account: 'supabase' };
      } catch (error) {
        return {
          ok: false,
          error: `${CONNECTION_ERROR}${statusSuffix(error)}`,
        };
      }
    },

    async listResources(): Promise<ExternalResource[]> {
      return (await listProjects()).map(normalizeSupabaseProject);
    },
  };
}

export { normalizeSupabaseProject } from './normalize';
