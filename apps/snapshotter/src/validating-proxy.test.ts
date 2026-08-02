import { request as httpRequest } from 'node:http';
import { connect as netConnect } from 'node:net';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SnapshotCaptureError } from './errors.js';
import {
  type ValidatingProxy,
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

async function proxyHttpRequest(proxyUrl: string, target: string) {
  const proxy = new URL(proxyUrl);
  return new Promise<number>((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: proxy.hostname,
        port: proxy.port,
        method: 'GET',
        path: target,
        headers: { host: new URL(target).host },
      },
      (response) => {
        response.resume();
        response.once('end', () => resolve(response.statusCode ?? 0));
      },
    );
    request.once('error', reject);
    request.end();
  });
}

describe('startValidatingProxy', () => {
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
});
