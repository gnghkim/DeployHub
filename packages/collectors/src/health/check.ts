export type HealthResult =
  | { kind: 'up'; status: number; latencyMs: number }
  | { kind: 'down'; status: number; latencyMs: number }
  | {
    kind: 'unreachable';
    reason: 'timeout' | 'network';
    latencyMs: number;
  };

export async function checkHttp(
  url: string,
  timeoutMs: number,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<HealthResult> {
  const startedAt = performance.now();

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    });
    const status = response.status;
    await response.body?.cancel();
    const latencyMs = performance.now() - startedAt;

    return status >= 200 && status <= 399
      ? { kind: 'up', status, latencyMs }
      : { kind: 'down', status, latencyMs };
  } catch (error) {
    const errorName = error instanceof Error ? error.name : '';
    return {
      kind: 'unreachable',
      reason: errorName === 'AbortError' || errorName === 'TimeoutError'
        ? 'timeout'
        : 'network',
      latencyMs: performance.now() - startedAt,
    };
  }
}
