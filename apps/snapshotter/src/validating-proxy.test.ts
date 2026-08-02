import { request as httpRequest, type ClientRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SnapshotCaptureError } from './errors.js';
import {
  DEFAULT_MAX_CONCURRENT_STREAMS,
  DEFAULT_MAX_PROXY_REQUESTS,
  DEFAULT_MAX_TRANSFER_BYTES,
  DEFAULT_PROXY_IDLE_TIMEOUT_MS,
  type ValidatingProxy,
  createPinnedRequestOptions,
  filterHopByHopHeaders,
  startValidatingProxy,
} from './validating-proxy.js';

const proxies: ValidatingProxy[] = [];

afterEach(async () => {
  await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
});

function resolver(ipv4: readonly string[], ipv6: readonly string[] = []) {
  return {
    resolve4: vi.fn(async () => [...ipv4]),
    resolve6: vi.fn(async () => [...ipv6]),
  };
}

async function proxyHttpRequest(proxyUrl: string, target: string, body?: Buffer) {
  const proxy = new URL(proxyUrl);
  return new Promise<number>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: proxy.hostname,
        port: proxy.port,
        method: body ? 'POST' : 'GET',
        path: target,
        headers: {
          host: new URL(target).host,
          ...(body ? { 'content-length': String(body.byteLength) } : {}),
        },
      },
      (response) => {
        response.resume();
        response.once('end', () => resolve(response.statusCode ?? 0));
        response.once('aborted', () => reject(new Error('proxy response aborted')));
        response.once('error', reject);
      },
    );
    request.once('error', reject);
    request.end(body);
  });
}

function openProxyHttpRequest(proxyUrl: string, target: string) {
  const proxy = new URL(proxyUrl);
  const request = httpRequest({
    hostname: proxy.hostname,
    port: proxy.port,
    method: 'GET',
    path: target,
    headers: { host: new URL(target).host },
  });
  request.on('error', () => undefined);
  request.end();
  return request;
}

describe('startValidatingProxy', () => {
  it('exports conservative bounded defaults', () => {
    expect(DEFAULT_MAX_PROXY_REQUESTS).toBe(256);
    expect(DEFAULT_MAX_CONCURRENT_STREAMS).toBe(32);
    expect(DEFAULT_MAX_TRANSFER_BYTES).toBe(64 * 1024 * 1024);
    expect(DEFAULT_PROXY_IDLE_TIMEOUT_MS).toBe(5_000);
  });

  it('removes fixed and Connection-nominated hop-by-hop headers', () => {
    expect(filterHopByHopHeaders({
      connection: 'keep-alive, x-secret, X-Second',
      'keep-alive': 'timeout=5',
      'x-secret': 'private',
      'x-second': 'private-too',
      'x-public': 'ok',
    })).toEqual({ 'x-public': 'ok' });
  });

  it('builds default outbound options with the target Host and pinned lookup', async () => {
    const signal = new AbortController().signal;
    const options = createPinnedRequestOptions(
      'POST',
      { host: 'attacker.invalid', connection: 'x-secret', 'x-secret': 'no' },
      new URL('https://example.com:443/path'),
      { address: '93.184.216.34', family: 4 },
      signal,
    );

    expect(options.headers).toEqual({ host: 'example.com' });
    expect(options.agent).toBe(false);
    await expect(new Promise((resolve, reject) => {
      options.lookup?.('example.com', {}, (error, address, family) => {
        if (error) reject(error);
        else resolve({ address, family });
      });
    })).resolves.toEqual({ address: '93.184.216.34', family: 4 });
  });

  it('does not start listening when its signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const outcome = await startValidatingProxy({ signal: controller.signal }).then(
      (proxy) => {
        proxies.push(proxy);
        return proxy;
      },
      (error: unknown) => error,
    );

    expect(outcome).toEqual(new SnapshotCaptureError('timeout'));
  });

  it('validates HTTP targets and forwards through a pinned public address', async () => {
    const addressResolver = resolver(['93.184.216.34']);
    const forwardHttp = vi.fn(async ({ request, response }) => {
      request.resume();
      response.writeHead(204);
      response.end();
    });
    const proxy = await startValidatingProxy({ addressResolver, forwardHttp });
    proxies.push(proxy);

    await expect(
      proxyHttpRequest(proxy.url, 'http://example.com/public?q=1'),
    ).resolves.toBe(204);

    expect(addressResolver.resolve4).toHaveBeenCalledWith('example.com');
    expect(addressResolver.resolve6).toHaveBeenCalledWith('example.com');
    expect(forwardHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        target: new URL('http://example.com/public?q=1'),
        address: { address: '93.184.216.34', family: 4 },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('rejects one private DNS answer before HTTP forwarding', async () => {
    const onFailure = vi.fn();
    const forwardHttp = vi.fn();
    const proxy = await startValidatingProxy({
      addressResolver: resolver(['93.184.216.34', '10.0.0.1']),
      forwardHttp,
      onFailure,
    });
    proxies.push(proxy);

    await expect(
      proxyHttpRequest(proxy.url, 'http://example.com/private'),
    ).rejects.toBeDefined();
    expect(forwardHttp).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'blocked_target' }),
    );
  });

  it('validates HTTPS CONNECT and dials the pinned address on port 443', async () => {
    const upstream = new PassThrough();
    const dialTunnel = vi.fn(async () => upstream);
    const proxy = await startValidatingProxy({
      addressResolver: resolver(['93.184.216.34']),
      dialTunnel,
    });
    proxies.push(proxy);
    const proxyAddress = new URL(proxy.url);

    const response = await new Promise<string>((resolve, reject) => {
      const socket = netConnect(Number(proxyAddress.port), proxyAddress.hostname, () => {
        socket.write('CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n');
      });
      socket.once('data', (chunk) => {
        resolve(chunk.toString('ascii'));
        socket.destroy();
      });
      socket.once('error', reject);
    });

    expect(response).toContain('200 Connection Established');
    expect(dialTunnel).toHaveBeenCalledWith(
      expect.objectContaining({
        hostname: 'example.com',
        port: 443,
        address: { address: '93.184.216.34', family: 4 },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('rejects CONNECT ports other than 443', async () => {
    const onFailure = vi.fn();
    const dialTunnel = vi.fn();
    const proxy = await startValidatingProxy({
      addressResolver: resolver(['93.184.216.34']),
      dialTunnel,
      onFailure,
    });
    proxies.push(proxy);
    const proxyAddress = new URL(proxy.url);

    await new Promise<void>((resolve) => {
      const socket = netConnect(Number(proxyAddress.port), proxyAddress.hostname, () => {
        socket.write('CONNECT example.com:8443 HTTP/1.1\r\nHost: example.com:8443\r\n\r\n');
      });
      socket.once('close', resolve);
    });

    expect(dialTunnel).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'blocked_target' }),
    );
  });

  it('rejects new traffic and closes active tunnels after capture blocking', async () => {
    const upstream = new PassThrough();
    const proxy = await startValidatingProxy({
      addressResolver: resolver(['93.184.216.34']),
      dialTunnel: vi.fn(async () => upstream),
    });
    proxies.push(proxy);
    const proxyAddress = new URL(proxy.url);
    const client = netConnect(Number(proxyAddress.port), proxyAddress.hostname);
    await new Promise<void>((resolve, reject) => {
      client.once('connect', () => {
        client.write('CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n');
      });
      client.once('data', () => resolve());
      client.once('error', reject);
    });

    proxy.block(new SnapshotCaptureError('blocked_target'));

    await new Promise<void>((resolve) => client.once('close', resolve));
    expect(upstream.destroyed).toBe(true);
    await expect(
      proxyHttpRequest(proxy.url, 'http://example.com/after-block'),
    ).rejects.toBeDefined();
    expect(proxy.failure).toMatchObject({ code: 'blocked_target' });
  });

  it('blocks after the total proxy request cap', async () => {
    const proxy = await startValidatingProxy({
      addressResolver: resolver(['93.184.216.34']),
      maxRequests: 1,
      forwardHttp: vi.fn(async ({ request, response }) => {
        request.resume();
        response.writeHead(204);
        response.end();
      }),
    });
    proxies.push(proxy);

    await expect(proxyHttpRequest(proxy.url, 'http://example.com/one')).resolves.toBe(204);
    await expect(proxyHttpRequest(proxy.url, 'http://example.com/two')).rejects.toBeDefined();
    expect(proxy.failure).toMatchObject({ code: 'navigation_failed' });
  });

  it('releases concurrent HTTP capacity exactly once after completion', async () => {
    const forwardHttp = vi.fn(async ({ request, response }) => {
      request.resume();
      response.writeHead(204);
      response.end();
    });
    const proxy = await startValidatingProxy({
      addressResolver: resolver(['93.184.216.34']),
      maxConcurrentStreams: 1,
      forwardHttp,
    });
    proxies.push(proxy);

    await expect(proxyHttpRequest(proxy.url, 'http://example.com/one')).resolves.toBe(204);
    await expect(proxyHttpRequest(proxy.url, 'http://example.com/two')).resolves.toBe(204);
    expect(forwardHttp).toHaveBeenCalledTimes(2);
    expect(proxy.failure).toBeUndefined();
  });

  it('blocks concurrent HTTP work above the stream cap and tears it down', async () => {
    let firstRequest: ClientRequest | undefined;
    const forwardHttp = vi.fn(async ({ request }) => {
      request.resume();
      await new Promise<never>(() => undefined);
    });
    const proxy = await startValidatingProxy({
      addressResolver: resolver(['93.184.216.34']),
      maxConcurrentStreams: 1,
      forwardHttp,
    });
    proxies.push(proxy);

    firstRequest = openProxyHttpRequest(proxy.url, 'http://example.com/one');
    await vi.waitFor(() => expect(forwardHttp).toHaveBeenCalledOnce());
    await expect(proxyHttpRequest(proxy.url, 'http://example.com/two')).rejects.toBeDefined();
    await vi.waitFor(() => expect(firstRequest?.destroyed).toBe(true));
    expect(proxy.failure).toMatchObject({ code: 'navigation_failed' });
  });

  it('blocks aggregate HTTP request and response transfer bytes', async () => {
    const proxy = await startValidatingProxy({
      addressResolver: resolver(['93.184.216.34']),
      maxTransferBytes: 1_500,
      forwardHttp: vi.fn(async ({ request, response }) => {
        request.resume();
        response.writeHead(200);
        response.end(Buffer.alloc(800));
      }),
    });
    proxies.push(proxy);

    await expect(
      proxyHttpRequest(proxy.url, 'http://example.com/large', Buffer.alloc(800)),
    ).rejects.toBeDefined();
    expect(proxy.failure).toMatchObject({ code: 'image_too_large' });
  });

  it('rejects oversized Content-Length before an HTTP response body is streamed', async () => {
    const bodyWritten = vi.fn();
    const proxy = await startValidatingProxy({
      addressResolver: resolver(['93.184.216.34']),
      maxTransferBytes: 1_024,
      forwardHttp: vi.fn(async ({ request, response }) => {
        request.resume();
        response.writeHead(200, { 'content-length': '4096' });
        bodyWritten();
        response.end(Buffer.alloc(4_096));
      }),
    });
    proxies.push(proxy);

    await expect(proxyHttpRequest(proxy.url, 'http://example.com/declared')).rejects.toBeDefined();
    expect(proxy.failure).toMatchObject({ code: 'image_too_large' });
    expect(bodyWritten).not.toHaveBeenCalled();
  });

  it('counts CONNECT bytes in both directions and destroys both sockets', async () => {
    const upstream = new PassThrough();
    const proxy = await startValidatingProxy({
      addressResolver: resolver(['93.184.216.34']),
      maxTransferBytes: 1_024,
      dialTunnel: vi.fn(async () => upstream),
    });
    proxies.push(proxy);
    const address = new URL(proxy.url);
    const client = netConnect(Number(address.port), address.hostname);
    await new Promise<void>((resolve) => {
      client.once('connect', () => client.write(
        'CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n',
      ));
      client.once('data', () => resolve());
    });

    client.write(Buffer.alloc(600));
    upstream.write(Buffer.alloc(600));

    await vi.waitFor(() => expect(proxy.failure).toMatchObject({ code: 'image_too_large' }));
    await vi.waitFor(() => expect(client.destroyed).toBe(true));
    expect(upstream.destroyed).toBe(true);
  });

  it('blocks and tears down an idle proxy socket', async () => {
    const proxy = await startValidatingProxy({
      addressResolver: resolver(['93.184.216.34']),
      idleTimeoutMs: 10,
      forwardHttp: vi.fn(async ({ request }) => {
        request.resume();
        await new Promise<never>(() => undefined);
      }),
    });
    proxies.push(proxy);
    const request = openProxyHttpRequest(proxy.url, 'http://example.com/idle');

    await vi.waitFor(() => expect(proxy.failure).toMatchObject({ code: 'navigation_failed' }));
    expect(request.destroyed).toBe(true);
  });
});
