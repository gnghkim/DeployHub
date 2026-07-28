import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { checkHttp } from './check';

function response(status: number): {
  value: Response;
  cancel: ReturnType<typeof vi.fn>;
} {
  const cancel = vi.fn().mockResolvedValue(undefined);
  return {
    value: {
      status,
      body: { cancel },
    } as unknown as Response,
    cancel,
  };
}

function mockLatency(start: number, end: number): void {
  vi.spyOn(performance, 'now')
    .mockReturnValueOnce(start)
    .mockReturnValueOnce(end);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('checkHttp', () => {
  it.each([200, 302, 399])(
    'reports HTTP %i as up without following redirects',
    async (status) => {
      const result = response(status);
      const fetch = vi.fn().mockResolvedValue(result.value);
      const signal = new AbortController().signal;
      vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
      mockLatency(10, 35);

      await expect(checkHttp(
        'https://example.com/health',
        2_000,
        fetch,
      )).resolves.toEqual({
        kind: 'up',
        status,
        latencyMs: 25,
      });
      expect(fetch).toHaveBeenCalledWith(
        'https://example.com/health',
        {
          method: 'GET',
          signal,
          redirect: 'manual',
        },
      );
      expect(AbortSignal.timeout).toHaveBeenCalledWith(2_000);
      expect(result.cancel).toHaveBeenCalledOnce();
    },
  );

  it.each([400, 500, 599])(
    'reports HTTP %i as down and releases the response body',
    async (status) => {
      const result = response(status);
      const fetch = vi.fn().mockResolvedValue(result.value);
      mockLatency(100, 112);

      await expect(checkHttp(
        'https://example.com',
        1_000,
        fetch,
      )).resolves.toEqual({
        kind: 'down',
        status,
        latencyMs: 12,
      });
      expect(result.cancel).toHaveBeenCalledOnce();
    },
  );

  it('reports AbortError as an unreachable timeout with latency', async () => {
    const fetch = vi.fn().mockRejectedValue(
      new DOMException('aborted', 'AbortError'),
    );
    mockLatency(20, 74);

    await expect(checkHttp(
      'https://example.com',
      1_000,
      fetch,
    )).resolves.toEqual({
      kind: 'unreachable',
      reason: 'timeout',
      latencyMs: 54,
    });
  });

  it('reports TimeoutError as an unreachable timeout with latency', async () => {
    const fetch = vi.fn().mockRejectedValue(
      new DOMException('timed out', 'TimeoutError'),
    );
    mockLatency(20, 74);

    await expect(checkHttp(
      'https://example.com',
      1_000,
      fetch,
    )).resolves.toEqual({
      kind: 'unreachable',
      reason: 'timeout',
      latencyMs: 54,
    });
  });

  it('reports other exceptions as an unreachable network error with latency', async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError('connection reset'));
    mockLatency(45, 51);

    await expect(checkHttp(
      'https://example.com',
      1_000,
      fetch,
    )).resolves.toEqual({
      kind: 'unreachable',
      reason: 'network',
      latencyMs: 6,
    });
  });
});
