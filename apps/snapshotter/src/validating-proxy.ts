import {
  createServer,
  request as httpRequest,
  type ClientRequest,
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

export type HttpRequestFunction = (
  target: URL,
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

export interface TunnelDialContext {
  hostname: string;
  port: 443;
  address: ValidatedAddress;
  signal: AbortSignal;
}

export interface ValidatingProxyOptions {
  addressResolver?: AddressResolver;
  signal?: AbortSignal;
  maxRequests?: number;
  maxConcurrentStreams?: number;
  maxTransferBytes?: number;
  idleTimeoutMs?: number;
  requestHttp?: HttpRequestFunction;
  requestHttps?: HttpRequestFunction;
  forwardHttp?: (context: HttpForwardContext) => Promise<void>;
  dialTunnel?: (context: TunnelDialContext) => Promise<Duplex>;
  onFailure?: (error: SnapshotCaptureError) => void;
}

export const DEFAULT_MAX_PROXY_REQUESTS = 256;
export const DEFAULT_MAX_CONCURRENT_STREAMS = 32;
export const DEFAULT_MAX_TRANSFER_BYTES = 64 * 1024 * 1024;
export const DEFAULT_PROXY_IDLE_TIMEOUT_MS = 5_000;

export interface ValidatingProxy {
  readonly url: string;
  readonly failure: SnapshotCaptureError | undefined;
  readonly activeStreamCount: number;
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

function connectionHeaderTokens(headers: IncomingHttpHeaders) {
  const value = headers.connection;
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return new Set(
    values.flatMap((entry) => entry.split(',')).map((entry) => entry.trim().toLowerCase()).filter(Boolean),
  );
}

export function filterHopByHopHeaders(headers: IncomingHttpHeaders) {
  const result: OutgoingHttpHeaders = {};
  const nominated = connectionHeaderTokens(headers);
  for (const [name, value] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase();
    if (
      value === undefined ||
      HOP_BY_HOP_HEADERS.has(normalizedName) ||
      nominated.has(normalizedName)
    ) continue;
    result[name] = value;
  }
  return result;
}

function requestHeaders(headers: IncomingHttpHeaders, target: URL) {
  const result = filterHopByHopHeaders(headers);
  result.host = target.host;
  return result;
}

export function createPinnedRequestOptions(
  method: string | undefined,
  headers: IncomingHttpHeaders,
  target: URL,
  address: ValidatedAddress,
  signal: AbortSignal,
): RequestOptions {
  return {
    method,
    headers: requestHeaders(headers, target),
    agent: false,
    lookup: pinnedLookup(address),
    signal,
  };
}

function responseHeaders(headers: IncomingHttpHeaders) {
  return filterHopByHopHeaders(headers);
}

async function forwardPinnedHttp({
  request,
  response,
  target,
  address,
  signal,
}: HttpForwardContext, requestHttp: HttpRequestFunction, requestHttps: HttpRequestFunction) {
  const requestFunction = target.protocol === 'https:' ? requestHttps : requestHttp;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let outgoing: ClientRequest | undefined;
    let incoming: IncomingMessage | undefined;
    const navigationFailure = () => new SnapshotCaptureError('navigation_failed');
    const destroyBothDirections = () => {
      if (outgoing) request.unpipe(outgoing);
      if (incoming) incoming.unpipe(response);
      if (!request.destroyed) request.destroy();
      if (outgoing && !outgoing.destroyed) outgoing.destroy();
      if (incoming && !incoming.destroyed) incoming.destroy();
      if (!response.destroyed && !response.writableEnded) response.destroy();
    };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      destroyBothDirections();
      reject(error);
    };
    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    response.once('error', rejectOnce);
    response.once('close', () => {
      if (!response.writableEnded) rejectOnce(navigationFailure());
    });
    request.once('error', rejectOnce);
    request.once('aborted', () => rejectOnce(navigationFailure()));

    try {
      outgoing = requestFunction(
        target,
        createPinnedRequestOptions(
          request.method,
          request.headers,
          target,
          address,
          signal,
        ),
        (upstreamResponse) => {
          if (settled) {
            upstreamResponse.destroy();
            return;
          }
          incoming = upstreamResponse;
          upstreamResponse.once('error', rejectOnce);
          upstreamResponse.once('aborted', () => rejectOnce(navigationFailure()));
          upstreamResponse.once('close', () => {
            if (!upstreamResponse.complete) rejectOnce(navigationFailure());
          });
          response.once('finish', resolveOnce);
          try {
            response.writeHead(
              upstreamResponse.statusCode ?? 502,
              responseHeaders(upstreamResponse.headers),
            );
            upstreamResponse.pipe(response);
          } catch (error) {
            rejectOnce(error);
          }
        },
      );
      outgoing.once('error', rejectOnce);
      outgoing.once('abort', () => rejectOnce(navigationFailure()));
      request.pipe(outgoing);
    } catch (error) {
      rejectOnce(error);
    }
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
  const forwardHttp = options.forwardHttp ?? ((context) => forwardPinnedHttp(
    context,
    options.requestHttp ?? httpRequest,
    options.requestHttps ?? httpsRequest,
  ));
  const dialTunnel = options.dialTunnel ?? dialPinnedTunnel;
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_PROXY_REQUESTS;
  const maxConcurrentStreams =
    options.maxConcurrentStreams ?? DEFAULT_MAX_CONCURRENT_STREAMS;
  const maxTransferBytes = options.maxTransferBytes ?? DEFAULT_MAX_TRANSFER_BYTES;
  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_PROXY_IDLE_TIMEOUT_MS;
  let failure: SnapshotCaptureError | undefined;
  let closed = false;
  let requestCount = 0;
  let concurrentStreams = 0;
  let transferredBytes = 0;

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

  const consumeBytes = (bytes: number) => {
    if (bytes <= 0) return true;
    if (transferredBytes + bytes > maxTransferBytes) {
      // Transfer exhaustion maps to the approved payload-size failure.
      block(new SnapshotCaptureError('image_too_large'));
      return false;
    }
    transferredBytes += bytes;
    return true;
  };
  const remainingBytes = () => Math.max(0, maxTransferBytes - transferredBytes);
  const acquireStream = () => {
    requestCount += 1;
    if (requestCount > maxRequests || concurrentStreams >= maxConcurrentStreams) {
      // Request, concurrency, and idle exhaustion are retryable navigation failures.
      block(new SnapshotCaptureError('navigation_failed'));
      return undefined;
    }
    concurrentStreams += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      concurrentStreams -= 1;
    };
  };
  const contentLengthFits = (value: string | string[] | number | undefined) => {
    if (value === undefined) return true;
    const text = Array.isArray(value) ? value[0] : String(value);
    if (!text || !/^\d+$/.test(text)) return true;
    if (Number(text) <= remainingBytes()) return true;
    block(new SnapshotCaptureError('image_too_large'));
    return false;
  };
  const meterClientSocket = (socket: Socket) => {
    socket.setTimeout(idleTimeoutMs, () => {
      block(new SnapshotCaptureError('navigation_failed'));
    });
    socket.on('data', (chunk: Buffer) => {
      consumeBytes(chunk.byteLength);
    });
    type MeteredWrite = (
      chunk: string | Uint8Array,
      ...arguments_: unknown[]
    ) => boolean;
    const writable = socket as unknown as { write: MeteredWrite };
    const originalWrite = writable.write.bind(socket);
    writable.write = (chunk, ...arguments_) => {
      const encoding = typeof arguments_[0] === 'string'
        ? arguments_[0] as BufferEncoding
        : undefined;
      const bytes = typeof chunk === 'string'
        ? Buffer.byteLength(chunk, encoding)
        : chunk.byteLength;
      if (!consumeBytes(bytes)) return false;
      return originalWrite(chunk, ...arguments_);
    };
  };
  const guardResponseLength = (response: ServerResponse) => {
    type WriteHead = (
      statusCode: number,
      ...arguments_: unknown[]
    ) => ServerResponse;
    const writable = response as unknown as { writeHead: WriteHead };
    const originalWriteHead = writable.writeHead.bind(response);
    writable.writeHead = (statusCode, ...arguments_) => {
      const suppliedHeaders = arguments_.find(
        (value): value is OutgoingHttpHeaders =>
          typeof value === 'object' && value !== null && !Array.isArray(value),
      );
      const contentLength = suppliedHeaders?.['content-length'] ??
        suppliedHeaders?.['Content-Length'] ??
        response.getHeader('content-length');
      if (!contentLengthFits(contentLength)) {
        throw new SnapshotCaptureError('image_too_large');
      }
      return originalWriteHead(statusCode, ...arguments_);
    };
  };

  const server = createServer((request, response) => {
    const client = request.socket;
    activeStreams.add(client);
    client.once('close', () => activeStreams.delete(client));
    if (failure) {
      client.destroy();
      return;
    }
    const releaseStream = acquireStream();
    if (!releaseStream) {
      client.destroy();
      return;
    }
    const release = () => releaseStream();
    request.once('aborted', release);
    response.once('finish', release);
    response.once('close', release);
    client.once('close', release);
    if (!contentLengthFits(request.headers['content-length'])) {
      release();
      client.destroy();
      return;
    }
    guardResponseLength(response);
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
      } finally {
        release();
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
    const releaseStream = acquireStream();
    if (!releaseStream) {
      client.destroy();
      return;
    }
    const release = () => releaseStream();
    client.once('close', release);
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
        upstream.once('close', () => {
          activeStreams.delete(upstream);
          release();
        });
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
        release();
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
    meterClientSocket(socket);
    socket.once('close', () => activeStreams.delete(socket));
    if (failure) socket.destroy();
  });

  if (failure) {
    options.signal?.removeEventListener('abort', onExternalAbort);
    throw failure;
  }

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
  } catch (error) {
    options.signal?.removeEventListener('abort', onExternalAbort);
    controller.abort();
    destroyStreams();
    throw error;
  }
  if (failure) {
    options.signal?.removeEventListener('abort', onExternalAbort);
    destroyStreams();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw failure;
  }
  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}`,
    get failure() {
      return failure;
    },
    get activeStreamCount() {
      return concurrentStreams;
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
