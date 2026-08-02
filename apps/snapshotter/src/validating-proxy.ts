import {
  createServer,
  request as httpRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type RequestOptions,
  type ServerResponse,
} from 'node:http';
import { request as httpsRequest } from 'node:https';
import {
  connect as netConnect,
  type AddressInfo,
  type Socket,
} from 'node:net';
import type { Duplex } from 'node:stream';

import { SnapshotCaptureError } from './errors.js';
import {
  type AddressResolver,
  type ValidatedAddress,
  resolvePublicHttpUrl,
} from './url-policy.js';

export interface HttpForwardContext {
  request: IncomingMessage;
  response: ServerResponse;
  target: URL;
  address: ValidatedAddress;
  signal: AbortSignal;
}

export interface TunnelDialContext {
  hostname: string;
  port: 443;
  address: ValidatedAddress;
  signal: AbortSignal;
}

export interface ValidatingProxyOptions {
  addressResolver?: AddressResolver;
  signal?: AbortSignal;
  forwardHttp?: (context: HttpForwardContext) => Promise<void>;
  dialTunnel?: (context: TunnelDialContext) => Promise<Duplex>;
  onFailure?: (error: SnapshotCaptureError) => void;
}

export interface ValidatingProxy {
  readonly url: string;
  readonly failure: SnapshotCaptureError | undefined;
  block(error: SnapshotCaptureError): void;
  close(): Promise<void>;
}

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function pinnedLookup(address: ValidatedAddress): NonNullable<RequestOptions['lookup']> {
  return ((
    _hostname: string,
    options: { all?: boolean },
    callback: (...arguments_: unknown[]) => void,
  ) => {
    if (options?.all) callback(null, [address]);
    else callback(null, address.address, address.family);
  }) as NonNullable<RequestOptions['lookup']>;
}

function requestHeaders(headers: IncomingHttpHeaders, target: URL) {
  const result: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    result[name] = value;
  }
  result.host = target.host;
  return result;
}

function responseHeaders(headers: IncomingHttpHeaders) {
  const result: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    result[name] = value;
  }
  return result;
}

async function forwardPinnedHttp({
  request,
  response,
  target,
  address,
  signal,
}: HttpForwardContext) {
  const requestFunction = target.protocol === 'https:' ? httpsRequest : httpRequest;
  await new Promise<void>((resolve, reject) => {
    const outgoing = requestFunction(
      target,
      {
        method: request.method,
        headers: requestHeaders(request.headers, target),
        agent: false,
        lookup: pinnedLookup(address),
        signal,
      },
      (incoming) => {
        response.writeHead(
          incoming.statusCode ?? 502,
          responseHeaders(incoming.headers),
        );
        incoming.pipe(response);
        incoming.once('end', resolve);
        incoming.once('error', reject);
      },
    );
    outgoing.once('error', reject);
    request.pipe(outgoing);
  });
}

async function dialPinnedTunnel({
  port,
  address,
  signal,
}: TunnelDialContext): Promise<Duplex> {
  return new Promise<Socket>((resolve, reject) => {
    const socket = netConnect({
      host: address.address,
      port,
      family: address.family,
      signal,
    });
    socket.once('connect', () => resolve(socket));
    socket.once('error', reject);
  });
}

function parseConnectAuthority(authority: string) {
  let host: string;
  let portText: string;
  if (authority.startsWith('[')) {
    const boundary = authority.indexOf(']:');
    if (boundary === -1) throw new SnapshotCaptureError('blocked_target');
    host = authority.slice(0, boundary + 1);
    portText = authority.slice(boundary + 2);
  } else {
    const boundary = authority.lastIndexOf(':');
    if (boundary <= 0 || authority.slice(0, boundary).includes(':')) {
      throw new SnapshotCaptureError('blocked_target');
    }
    host = authority.slice(0, boundary);
    portText = authority.slice(boundary + 1);
  }
  if (portText !== '443') throw new SnapshotCaptureError('blocked_target');
  return new URL(`https://${host}:443/`);
}

function normalizedFailure(error: unknown) {
  return error instanceof SnapshotCaptureError
    ? error
    : new SnapshotCaptureError('navigation_failed');
}

export async function startValidatingProxy(
  options: ValidatingProxyOptions = {},
): Promise<ValidatingProxy> {
  const controller = new AbortController();
  const activeStreams = new Set<Duplex>();
  const forwardHttp = options.forwardHttp ?? forwardPinnedHttp;
  const dialTunnel = options.dialTunnel ?? dialPinnedTunnel;
  let failure: SnapshotCaptureError | undefined;
  let closed = false;

  const destroyStreams = () => {
    for (const stream of activeStreams) stream.destroy();
    activeStreams.clear();
  };
  const block = (error: SnapshotCaptureError) => {
    if (failure) return;
    failure = error;
    controller.abort();
    try {
      options.onFailure?.(error);
    } catch {
      // Failure reporting cannot weaken the proxy boundary.
    }
    destroyStreams();
  };
  const onExternalAbort = () => block(new SnapshotCaptureError('timeout'));
  options.signal?.addEventListener('abort', onExternalAbort, { once: true });
  if (options.signal?.aborted) onExternalAbort();

  const server = createServer((request, response) => {
    const client = request.socket;
    activeStreams.add(client);
    client.once('close', () => activeStreams.delete(client));
    if (failure) {
      client.destroy();
      return;
    }
    void (async () => {
      try {
        if (!request.url || !/^https?:\/\//i.test(request.url)) {
          throw new SnapshotCaptureError('blocked_target');
        }
        const resolved = await resolvePublicHttpUrl(
          request.url,
          options.addressResolver,
        );
        const address = resolved.addresses[0];
        if (!address) throw new SnapshotCaptureError('blocked_target');
        if (request.destroyed || failure) return;
        await forwardHttp({
          request,
          response,
          target: new URL(resolved.url),
          address,
          signal: controller.signal,
        });
      } catch (error) {
        block(normalizedFailure(error));
        if (!response.headersSent) response.destroy();
      }
    })();
  });

  server.on('connect', (request, client, head) => {
    activeStreams.add(client);
    client.once('close', () => activeStreams.delete(client));
    if (failure) {
      client.destroy();
      return;
    }
    void (async () => {
      try {
        const target = parseConnectAuthority(request.url ?? '');
        const resolved = await resolvePublicHttpUrl(
          target.toString(),
          options.addressResolver,
        );
        const address = resolved.addresses[0];
        if (!address) throw new SnapshotCaptureError('blocked_target');
        if (client.destroyed || failure) return;
        const upstream = await dialTunnel({
          hostname: target.hostname.replace(/^\[|\]$/g, ''),
          port: 443,
          address,
          signal: controller.signal,
        });
        if (client.destroyed || failure) {
          upstream.destroy();
          return;
        }
        activeStreams.add(upstream);
        upstream.once('close', () => activeStreams.delete(upstream));
        const closeBoth = () => {
          client.destroy();
          upstream.destroy();
        };
        client.once('error', closeBoth);
        upstream.once('error', closeBoth);
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.byteLength > 0) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      } catch (error) {
        block(normalizedFailure(error));
        client.destroy();
      }
    })();
  });

  server.on('upgrade', (_request, socket) => {
    block(new SnapshotCaptureError('blocked_target'));
    socket.destroy();
  });
  server.on('connection', (socket) => {
    activeStreams.add(socket);
    socket.once('close', () => activeStreams.delete(socket));
    if (failure) socket.destroy();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}`,
    get failure() {
      return failure;
    },
    block,
    async close() {
      if (closed) return;
      closed = true;
      options.signal?.removeEventListener('abort', onExternalAbort);
      controller.abort();
      destroyStreams();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}
