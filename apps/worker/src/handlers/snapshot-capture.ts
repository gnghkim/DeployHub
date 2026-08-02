import { createHash } from 'node:crypto';
import {
  enqueueUnique,
  markSnapshotFailed,
  markSnapshotPendingAttempt,
  reconcileStaleSnapshotCapture,
  saveAutomaticSnapshot,
  SnapshotProjectNotFoundError,
  type Db,
  type SnapshotErrorCode,
} from '@deployhub/db';
import type { JobHandler } from '../runner';

export type SnapshotCapturePayload = {
  projectId: string;
  url: string;
  deploymentId?: string;
  requestId?: string;
};

type SnapshotCaptureDependencies = {
  fetch?: typeof fetch;
};

const CAPTURE_WIDTH = 1440;
const CAPTURE_HEIGHT = 900;
const CAPTURE_TIMEOUT_MS = 20_000;
const MAX_IMAGE_BYTES = 1_500_000;
const MAX_ERROR_BYTES = 8_192;
const INVALID_PAYLOAD_ERROR = 'invalid snapshot capture payload';
const APPROVED_ERROR_CODES = new Set<SnapshotErrorCode>([
  'timeout',
  'blocked_target',
  'navigation_failed',
  'render_failed',
  'image_too_large',
]);
const PERMANENT_ERROR_CODES = new Set<SnapshotErrorCode>([
  'blocked_target',
  'image_too_large',
]);

class CaptureFailure extends Error {
  constructor(readonly code: SnapshotErrorCode) {
    super(code);
  }
}

function retryError(code: SnapshotErrorCode): Error {
  return new Error(`snapshot capture failed: ${code}`);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function parsePayload(value: unknown): SnapshotCapturePayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(INVALID_PAYLOAD_ERROR);
  }
  const record = value as Record<string, unknown>;
  const allowedKeys = new Set([
    'projectId',
    'url',
    'deploymentId',
    'requestId',
  ]);
  if (
    Object.keys(record).some((key) => !allowedKeys.has(key))
    || !isNonEmptyString(record.projectId)
    || !isNonEmptyString(record.url)
    || (record.deploymentId !== undefined
      && !isNonEmptyString(record.deploymentId))
    || (record.requestId !== undefined && !isNonEmptyString(record.requestId))
  ) {
    throw new Error(INVALID_PAYLOAD_ERROR);
  }
  return {
    projectId: record.projectId,
    url: record.url,
    ...(record.deploymentId === undefined
      ? {}
      : { deploymentId: record.deploymentId }),
    ...(record.requestId === undefined ? {} : { requestId: record.requestId }),
  };
}

function captureEndpoint(snapshotterUrl: string | undefined): string | null {
  if (snapshotterUrl === undefined || snapshotterUrl.trim() === '') return null;
  try {
    const parsed = new URL(snapshotterUrl.trim());
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      || parsed.username !== ''
      || parsed.password !== ''
    ) {
      return null;
    }
    parsed.pathname = '/capture';
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function contentLength(response: Response): number | null {
  const raw = response.headers.get('content-length');
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) throw new CaptureFailure('render_failed');
  const length = Number(raw);
  if (!Number.isSafeInteger(length)) throw new CaptureFailure('render_failed');
  return length;
}

async function readBounded(
  response: Response,
  maximumBytes: number,
  overflowCode: SnapshotErrorCode,
): Promise<Buffer> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    const declaredLength = contentLength(response);
    if (declaredLength !== null && declaredLength > maximumBytes) {
      throw new CaptureFailure(overflowCode);
    }
    if (response.body === null) throw new CaptureFailure('render_failed');
    reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        chunks.length = 0;
        throw new CaptureFailure(overflowCode);
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    if (reader !== undefined) {
      await reader.cancel().catch(() => undefined);
    } else {
      await cancelResponseBody(response);
    }
    if (error instanceof CaptureFailure) throw error;
    throw new CaptureFailure('render_failed');
  } finally {
    reader?.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function cancelResponseBody(response: Response): Promise<void> {
  if (response.body === null || response.body.locked) return;
  await response.body.cancel().catch(() => undefined);
}

function mediaType(response: Response): string | null {
  return response.headers
    .get('content-type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase() ?? null;
}

async function responseErrorCode(response: Response): Promise<SnapshotErrorCode> {
  if (mediaType(response) !== 'application/json') {
    await cancelResponseBody(response);
    return 'render_failed';
  }
  try {
    const body = await readBounded(response, MAX_ERROR_BYTES, 'render_failed');
    const parsed: unknown = JSON.parse(body.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return 'render_failed';
    }
    const error = (parsed as Record<string, unknown>).error;
    if (!error || typeof error !== 'object' || Array.isArray(error)) {
      return 'render_failed';
    }
    const code = (error as Record<string, unknown>).code;
    if (typeof code !== 'string' || !APPROVED_ERROR_CODES.has(
      code as SnapshotErrorCode,
    )) {
      return 'render_failed';
    }
    const approved = code as SnapshotErrorCode;
    if (response.status === 503 && PERMANENT_ERROR_CODES.has(approved)) {
      return 'navigation_failed';
    }
    return approved;
  } catch {
    return 'render_failed';
  }
}

async function validateSuccess(response: Response): Promise<Buffer> {
  if (mediaType(response) !== 'image/webp') {
    await cancelResponseBody(response);
    throw new CaptureFailure('render_failed');
  }
  if (
    response.headers.get('x-image-width') !== String(CAPTURE_WIDTH)
    || response.headers.get('x-image-height') !== String(CAPTURE_HEIGHT)
  ) {
    await cancelResponseBody(response);
    throw new CaptureFailure('render_failed');
  }
  const image = await readBounded(
    response,
    MAX_IMAGE_BYTES,
    'image_too_large',
  );
  if (image.byteLength === 0) throw new CaptureFailure('render_failed');
  return image;
}

async function captureImage(
  fetchImpl: typeof fetch,
  endpoint: string,
  url: string,
): Promise<Buffer> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new CaptureFailure('timeout'));
    }, CAPTURE_TIMEOUT_MS);
  });
  const request = (async () => {
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          url,
          viewport: { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new CaptureFailure(
        timedOut || controller.signal.aborted || isAbortError(error)
          ? 'timeout'
          : 'navigation_failed',
      );
    }
    if (response.status !== 200) {
      throw new CaptureFailure(await responseErrorCode(response));
    }
    return validateSuccess(response);
  })();

  try {
    return await Promise.race([request, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function recordFailure(
  db: Db,
  payload: SnapshotCapturePayload,
  code: SnapshotErrorCode,
): Promise<boolean> {
  try {
    return await markSnapshotFailed(db, payload.projectId, payload.url, code);
  } catch (error) {
    if (error instanceof SnapshotProjectNotFoundError) return false;
    throw retryError(code);
  }
}

async function finishFailure(
  db: Db,
  jobId: string,
  payload: SnapshotCapturePayload,
  attemptedAt: Date,
  code: SnapshotErrorCode,
): Promise<void> {
  const current = await recordFailure(db, payload, code);
  if (!current) {
    await reconcileStaleAttempt(db, jobId, payload, attemptedAt);
    return;
  }
  if (PERMANENT_ERROR_CODES.has(code)) return;
  throw retryError(code);
}

async function reconcileStaleAttempt(
  db: Db,
  jobId: string,
  payload: SnapshotCapturePayload,
  attemptedAt?: Date,
): Promise<void> {
  try {
    await reconcileStaleSnapshotCapture(db, {
      jobId,
      projectId: payload.projectId,
      expectedUrl: payload.url,
      attemptedAt,
    });
  } catch (error) {
    if (error instanceof SnapshotProjectNotFoundError) return;
    throw retryError('navigation_failed');
  }
}

export function createSnapshotCaptureHandler(
  db: Db,
  snapshotterUrl: string | undefined,
  dependencies: SnapshotCaptureDependencies = {},
): JobHandler {
  const fetchImpl = dependencies.fetch ?? fetch;

  return async (job) => {
    const payload = parsePayload(job.payload);
    let attemptedAt: Date;
    try {
      const pending = await markSnapshotPendingAttempt(
        db,
        payload.projectId,
        payload.url,
      );
      if (!pending) {
        await reconcileStaleAttempt(db, job.id, payload);
        return;
      }
      attemptedAt = pending.attemptedAt;
    } catch (error) {
      if (error instanceof SnapshotProjectNotFoundError) return;
      throw retryError('navigation_failed');
    }

    const endpoint = captureEndpoint(snapshotterUrl);
    if (endpoint === null) {
      await finishFailure(
        db,
        job.id,
        payload,
        attemptedAt,
        'navigation_failed',
      );
      return;
    }

    let imageData: Buffer;
    try {
      imageData = await captureImage(fetchImpl, endpoint, payload.url);
    } catch (error) {
      const code = error instanceof CaptureFailure
        ? error.code
        : 'render_failed';
      await finishFailure(db, job.id, payload, attemptedAt, code);
      return;
    }

    let saved: boolean;
    try {
      saved = await saveAutomaticSnapshot(db, {
        projectId: payload.projectId,
        url: payload.url,
        deploymentId: payload.deploymentId,
        imageData,
        width: CAPTURE_WIDTH,
        height: CAPTURE_HEIGHT,
        checksum: createHash('sha256').update(imageData).digest('hex'),
      });
    } catch (error) {
      if (error instanceof SnapshotProjectNotFoundError) return;
      await finishFailure(db, job.id, payload, attemptedAt, 'render_failed');
      return;
    }
    if (!saved) {
      await reconcileStaleAttempt(db, job.id, payload, attemptedAt);
    }
  };
}

export async function enqueueSnapshotCapture(
  db: Db,
  payload: SnapshotCapturePayload,
): Promise<boolean> {
  return enqueueUnique(db, {
    type: 'snapshot.capture',
    dedupeKey: `snapshot:${payload.projectId}`,
    payload: { ...payload },
    maxAttempts: 3,
  });
}
