import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseCollector } from './index';

type TestResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

const fetchMock = vi.fn<
  (input: string, init: { headers: Record<string, string> }) =>
    Promise<TestResponse>
>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

function response(value: unknown, status = 200): TestResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(value),
  };
}

describe('createSupabaseCollector', () => {
  it('sends the PAT only in the Authorization header', async () => {
    fetchMock.mockResolvedValue(response([{
      ref: 'abcdefghijklmnopqrst',
      name: 'LinkVault',
      status: 'ACTIVE_HEALTHY',
      region: 'ap-northeast-2',
    }]));

    const resources = await createSupabaseCollector(
      'pat-secret',
    ).listResources();

    expect(resources).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.supabase.com/v1/projects',
      { headers: { authorization: 'Bearer pat-secret' } },
    );
    expect(JSON.stringify(resources)).not.toContain('pat-secret');
  });

  it('returns the stable single-account identity for an empty list', async () => {
    fetchMock.mockResolvedValue(response([]));

    await expect(createSupabaseCollector('pat-secret').testConnection())
      .resolves.toEqual({ ok: true, account: 'supabase' });
  });

  it('normalizes a large project list in one request', async () => {
    const projects = Array.from({ length: 500 }, (_, index) => ({
      ref: `project-ref-${index}`,
      name: `Project ${index}`,
      status: 'ACTIVE_HEALTHY',
    }));
    fetchMock.mockResolvedValue(response(projects));

    await expect(createSupabaseCollector('pat-secret').listResources())
      .resolves.toHaveLength(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns a safe HTTP connection error', async () => {
    fetchMock.mockResolvedValue(response({ message: 'pat-secret' }, 401));

    const result = await createSupabaseCollector(
      'pat-secret',
    ).testConnection();

    expect(result).toEqual({
      ok: false,
      error: 'Supabase 연결을 확인하지 못했습니다. (HTTP 401)',
    });
    expect(JSON.stringify(result)).not.toContain('pat-secret');
  });

  it('does not expose rejected-fetch text', async () => {
    fetchMock.mockRejectedValue(
      new Error('pat-secret socket error'),
    );

    await expect(createSupabaseCollector('pat-secret').listResources())
      .rejects.toThrow('Supabase API 요청에 실패했습니다.');
  });

  it.each([{}, { projects: [] }])(
    'rejects a non-array project list',
    async (body) => {
      fetchMock.mockResolvedValue(response(body));

      await expect(createSupabaseCollector('pat-secret').listResources())
        .rejects.toThrow('Supabase API 응답 형식이 올바르지 않습니다.');
    },
  );

  it('rejects malformed JSON without exposing the raw body', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockRejectedValue(new Error('pat-secret raw body')),
    });

    await expect(createSupabaseCollector('pat-secret').listResources())
      .rejects.toThrow('Supabase API 응답 형식이 올바르지 않습니다.');
  });

  it('rejects a malformed project entry through the normalizer', async () => {
    fetchMock.mockResolvedValue(response([{ name: 'LinkVault' }]));

    await expect(createSupabaseCollector('pat-secret').listResources())
      .rejects.toThrow('Supabase 프로젝트 응답의 필수 필드가 없습니다.');
  });
});
