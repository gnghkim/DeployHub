import { randomUUID } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { pathToFileURL } from 'node:url';

import {
  CAPTURE_HEIGHT,
  CAPTURE_TIMEOUT_MS,
  CAPTURE_WIDTH,
  MAX_IMAGE_BYTES,
  captureSnapshot,
} from './capture.js';
import {
  SNAPSHOT_ERROR_MESSAGES,
  SnapshotCaptureError,
  type SnapshotErrorCode,
} from './errors.js';

export const REQUEST_BODY_LIMIT_BYTES = 16 * 1024;
export const DEFAULT_MAX_CONCURRENT_CAPTURES = 2;
const DEFAULT_HEADERS_TIMEOUT_MS = 10_000;
const DEFAULT_KEEP_ALIVE_TIMEOUT_MS = 5_000;

type CaptureFunction = (url: string, signal: AbortSignal) => Promise<Buffer>;

export interface CaptureLogEntry {
  requestId: string;
  durationMs: number;
  code: 'success' | SnapshotErrorCode;
}

export interface SnapshotServerOptions {
  capture?: CaptureFunction;
  log?: (entry: CaptureLogEntry) => void;
  requestId?: () => string;
  requestTimeoutMs?: number;
  admission?: CaptureAdmission;
}

export interface CaptureAdmission {
  tryAcquire(): (() => void) | undefined;
}

export function createCaptureAdmission(
  maximum = DEFAULT_MAX_CONCURRENT_CAPTURES,
): CaptureAdmission {
  if (!Number.isInteger(maximum) || maximum < 1) {
    throw new RangeError('Capture admission maximum must be a positive integer.');
  }
  let active = 0;
  return {
    tryAcquire() {
      if (active >= maximum) return undefined;
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
      };
    },
  };
}

const processAdmission = createCaptureAdmission();

export interface SnapshotServerStartOptions extends SnapshotServerOptions {
  port?: number;
  host?: string;
}

class RequestError extends Error {
  constructor(readonly status: number) {
    super('Invalid capture request.');
  }
}

function defaultLog(entry: CaptureLogEntry) {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

function sendJson(
  response: ServerResponse,
  status: number,
  code: SnapshotErrorCode,
  closeConnection = false,
) {
  if (response.destroyed || response.writableEnded) return;
  const body = Buffer.from(
    JSON.stringify({ error: { code, message: SNAPSHOT_ERROR_MESSAGES[code] } }),
  );
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.byteLength),
    ...(closeConnection ? { connection: 'close' } : {}),
  });
  response.end(body);
}

function statusForCaptureError(code: SnapshotErrorCode) {
  switch (code) {
    case 'blocked_target':
      return 400;
    case 'image_too_large':
      return 413;
    case 'timeout':
      return 504;
    case 'navigation_failed':
      return 502;
    case 'render_failed':
      return 500;
  }
}

function contentTypeIsJson(request: IncomingMessage) {
  const contentType = request.headers['content-type'];
  return (
    typeof contentType === 'string' &&
    contentType.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
  );
}

function contentLengthExceedsLimit(request: IncomingMessage) {
  const contentLength = request.headers['content-length'];
  if (contentLength === undefined) return false;
  if (!/^\d+$/.test(contentLength)) return true;
  return Number(contentLength) > REQUEST_BODY_LIMIT_BYTES;
}

async function readBoundedBody(request: IncomingMessage, signal: AbortSignal) {
  if (contentLengthExceedsLimit(request)) {
    throw new RequestError(413);
  }

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let tooLarge = false;

    const cleanup = () => {
      request.removeListener('data', onData);
      request.removeListener('end', onEnd);
      request.removeListener('error', onError);
      signal.removeEventListener('abort', onAbort);
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (bytes > REQUEST_BODY_LIMIT_BYTES) {
        tooLarge = true;
        chunks.length = 0;
      } else if (!tooLarge) {
        chunks.push(buffer);
      }
    };
    const onEnd = () => {
      cleanup();
      if (tooLarge) reject(new RequestError(413));
      else resolve(Buffer.concat(chunks, bytes));
    };
    const onError = () => {
      cleanup();
      reject(new RequestError(400));
    };
    const onAbort = () => {
      cleanup();
      request.resume();
      reject(new SnapshotCaptureError('timeout'));
    };

    request.on('data', onData);
    request.once('end', onEnd);
    request.once('error', onError);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
}

interface CaptureRequestBody {
  url: string;
  viewport: { width: 1440; height: 900 };
}

function parseCaptureRequest(buffer: Buffer): CaptureRequestBody {
  let value: unknown;
  try {
    value = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new RequestError(400);
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RequestError(400);
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    typeof record.url !== 'string' ||
    record.url.length === 0 ||
    !record.viewport ||
    typeof record.viewport !== 'object' ||
    Array.isArray(record.viewport)
  ) {
    throw new RequestError(400);
  }

  const viewport = record.viewport as Record<string, unknown>;
  if (
    Object.keys(viewport).length !== 2 ||
    viewport.width !== CAPTURE_WIDTH ||
    viewport.height !== CAPTURE_HEIGHT
  ) {
    throw new RequestError(400);
  }

  return {
    url: record.url,
    viewport: { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT },
  };
}

async function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new SnapshotCaptureError('timeout');
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new SnapshotCaptureError('timeout'));
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

function handleRejectedRoute(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
) {
  if (status === 405) response.setHeader('allow', 'POST');
  response.once('finish', () => request.destroy());
  sendJson(response, status, 'blocked_target', true);
}

export function createSnapshotServer(options: SnapshotServerOptions = {}): Server {
  const capture = options.capture ?? ((url, signal) => captureSnapshot(url, { signal }));
  const log = options.log ?? defaultLog;
  const createRequestId = options.requestId ?? randomUUID;
  const requestTimeoutMs = options.requestTimeoutMs ?? CAPTURE_TIMEOUT_MS;
  const admission = options.admission ?? processAdmission;

  const server = createServer((request, response) => {
    const requestId = createRequestId();
    const startedAt = performance.now();
    let logged = false;
    const finish = (code: CaptureLogEntry['code']) => {
      if (logged) return;
      logged = true;
      try {
        log({
          requestId,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          code,
        });
      } catch {
        // Observability must never alter an already-normalized HTTP response.
      }
    };

    if (request.url !== '/capture') {
      handleRejectedRoute(request, response, 404);
      finish('blocked_target');
      return;
    }
    if (request.method !== 'POST') {
      handleRejectedRoute(request, response, 405);
      finish('blocked_target');
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    timer.unref();
    const onRequestAborted = () => controller.abort();
    const onResponseClosed = () => {
      if (!response.writableEnded) controller.abort();
    };
    request.once('aborted', onRequestAborted);
    response.once('close', onResponseClosed);

    void (async () => {
      let releaseAdmission: (() => void) | undefined;
      try {
        if (!contentTypeIsJson(request)) throw new RequestError(415);
        const body = parseCaptureRequest(
          await readBoundedBody(request, controller.signal),
        );
        releaseAdmission = admission.tryAcquire();
        if (!releaseAdmission) {
          sendJson(response, 503, 'navigation_failed');
          finish('navigation_failed');
          return;
        }
        const image = await withAbort(capture(body.url, controller.signal), controller.signal);
        if (image.byteLength > MAX_IMAGE_BYTES) {
          throw new SnapshotCaptureError('image_too_large');
        }

        response.writeHead(200, {
          'cache-control': 'no-store',
          'content-type': 'image/webp',
          'content-length': String(image.byteLength),
          'x-image-width': String(CAPTURE_WIDTH),
          'x-image-height': String(CAPTURE_HEIGHT),
        });
        response.end(image);
        finish('success');
      } catch (error) {
        if (error instanceof RequestError) {
          response.once('finish', () => request.destroy());
          sendJson(response, error.status, 'blocked_target', true);
          finish('blocked_target');
          return;
        }
        const normalized =
          error instanceof SnapshotCaptureError
            ? error
            : new SnapshotCaptureError('render_failed');
        sendJson(response, statusForCaptureError(normalized.code), normalized.code);
        finish(normalized.code);
      } finally {
        releaseAdmission?.();
        clearTimeout(timer);
        request.removeListener('aborted', onRequestAborted);
        response.removeListener('close', onResponseClosed);
      }
    })();
  });
  server.requestTimeout = requestTimeoutMs;
  server.headersTimeout = Math.min(requestTimeoutMs, DEFAULT_HEADERS_TIMEOUT_MS);
  server.keepAliveTimeout = DEFAULT_KEEP_ALIVE_TIMEOUT_MS;
  return server;
}

function configuredPort() {
  const value = process.env.PORT;
  if (value === undefined) return 3001;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : 3001;
}

export async function startSnapshotServer(
  options: SnapshotServerStartOptions = {},
): Promise<Server> {
  const server = createSnapshotServer(options);
  const port = options.port ?? configuredPort();
  const host = options.host;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return server;
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  void startSnapshotServer().catch(() => {
    process.exitCode = 1;
  });
}
