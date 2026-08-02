import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { MAX_IMAGE_BYTES } from './capture.js';
import { SnapshotCaptureError } from './errors.js';
import {
  REQUEST_BODY_LIMIT_BYTES,
  createSnapshotServer,
  type SnapshotServerOptions,
} from './server.js';

const openServers: Array<ReturnType<typeof createSnapshotServer>> = [];

afterEach(async () => {
  await Promise.all(
    openServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

async function withServer(
  options: Partial<SnapshotServerOptions>,
  run: (baseUrl: string) => Promise<void>,
) {
  const server = createSnapshotServer({
    capture: vi.fn(async () => Buffer.from('RIFF0000WEBPimage')),
    log: vi.fn(),
    requestId: () => 'request-1',
    ...options,
  });
  openServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  await run(`http://127.0.0.1:${address.port}`);
}

function captureRequest(url = 'https://example.com/') {
  return {
    url,
    viewport: { width: 1440, height: 900 },
  };
}

async function postJson(baseUrl: string, body: unknown) {
  return fetch(`${baseUrl}/capture`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('snapshotter server', () => {
  it('serves a bounded WebP response for the fixed viewport', async () => {
    const image = Buffer.from('RIFF0000WEBPimage');
    const capture = vi.fn(async () => image);
    const log = vi.fn();

    await withServer({ capture, log }, async (baseUrl) => {
      const response = await postJson(baseUrl, captureRequest());

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('image/webp');
      expect(response.headers.get('content-length')).toBe(String(image.byteLength));
      expect(response.headers.get('x-image-width')).toBe('1440');
      expect(response.headers.get('x-image-height')).toBe('900');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(image);
    });

    expect(capture).toHaveBeenCalledWith('https://example.com/', expect.any(AbortSignal));
    expect(log).toHaveBeenCalledWith({
      requestId: 'request-1',
      durationMs: expect.any(Number),
      code: 'success',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('example.com');
  });

  it('does not let logger failures alter a completed response', async () => {
    await withServer(
      {
        log: vi.fn(() => {
          throw new Error('logger unavailable');
        }),
      },
      async (baseUrl) => {
        const response = await postJson(baseUrl, captureRequest());

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/webp');
        expect(Buffer.from(await response.arrayBuffer())).toEqual(
          Buffer.from('RIFF0000WEBPimage'),
        );
      },
    );
  });

  it.each([
    ['GET', '/capture', 405],
    ['PUT', '/capture', 405],
    ['POST', '/unknown', 404],
    ['POST', '/capture?url=https://example.com', 404],
  ])('rejects %s %s', async (method, path, status) => {
    await withServer({}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}${path}`, { method });

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: 'blocked_target',
          message: 'The capture target is not allowed.',
        },
      });
    });
  });

  it.each([
    ['wrong viewport width', { url: 'https://example.com/', viewport: { width: 1280, height: 900 } }],
    ['wrong viewport height', { url: 'https://example.com/', viewport: { width: 1440, height: 1000 } }],
    ['missing URL', { viewport: { width: 1440, height: 900 } }],
    ['extra input', { ...captureRequest(), cookies: ['secret=value'] }],
  ])('rejects invalid input: %s', async (_name, body) => {
    const capture = vi.fn(async () => Buffer.from('unused'));
    await withServer({ capture }, async (baseUrl) => {
      const response = await postJson(baseUrl, body);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'blocked_target' },
      });
    });
    expect(capture).not.toHaveBeenCalled();
  });

  it('requires an application/json request body', async () => {
    await withServer({}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/capture`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: JSON.stringify(captureRequest()),
      });

      expect(response.status).toBe(415);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'blocked_target' },
      });
    });
  });

  it('rejects malformed JSON', async () => {
    await withServer({}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/capture`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{bad json',
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'blocked_target' },
      });
    });
  });

  it('caps request JSON bodies at 16 KiB', async () => {
    await withServer({}, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/capture`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...captureRequest(), padding: 'x'.repeat(REQUEST_BODY_LIMIT_BYTES) }),
      });

      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'blocked_target' },
      });
    });
  });

  it.each([
    ['blocked_target', 400],
    ['image_too_large', 413],
    ['navigation_failed', 502],
    ['render_failed', 500],
    ['timeout', 504],
  ] as const)('normalizes %s capture failures', async (code, expectedStatus) => {
    const capture = vi.fn(async () => {
      throw new SnapshotCaptureError(code);
    });

    await withServer({ capture }, async (baseUrl) => {
      const response = await postJson(baseUrl, captureRequest('https://example.com/private?q=secret'));

      expect(response.status).toBe(expectedStatus);
      await expect(response.json()).resolves.toEqual({
        error: {
          code,
          message: new SnapshotCaptureError(code).message,
        },
      });
    });
  });

  it('converts arbitrary capture failures to a safe render error', async () => {
    const capture = vi.fn(async () => {
      throw new Error('https://user:password@example.com/private?token=secret');
    });

    await withServer({ capture }, async (baseUrl) => {
      const response = await postJson(baseUrl, captureRequest());
      const body = await response.text();

      expect(response.status).toBe(500);
      expect(JSON.parse(body)).toEqual({
        error: {
          code: 'render_failed',
          message: 'The page could not be rendered.',
        },
      });
      expect(body).not.toContain('example.com');
      expect(body).not.toContain('secret');
    });
  });

  it('enforces the response size cap even for an injected capture function', async () => {
    const capture = vi.fn(async () => Buffer.alloc(MAX_IMAGE_BYTES + 1));

    await withServer({ capture }, async (baseUrl) => {
      const response = await postJson(baseUrl, captureRequest());

      expect(response.status).toBe(413);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'image_too_large' },
      });
    });
  });

  it('aborts capture at the request deadline and returns timeout', async () => {
    const capture = vi.fn(
      async (_url: string, signal: AbortSignal) =>
        new Promise<Buffer>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new SnapshotCaptureError('timeout')),
            { once: true },
          );
        }),
    );

    await withServer({ capture, requestTimeoutMs: 5 }, async (baseUrl) => {
      const response = await postJson(baseUrl, captureRequest());

      expect(response.status).toBe(504);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'timeout' },
      });
    });
  });
});
