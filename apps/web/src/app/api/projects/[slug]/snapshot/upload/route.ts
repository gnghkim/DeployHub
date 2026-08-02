import {
  SnapshotProjectNotFoundError,
  type Db,
} from '@deployhub/db';
import { auth } from '../../../../../../auth/config';
import { db } from '../../../../../../lib/db';
import { SnapshotUploadError } from '../../../../../../lib/snapshot-upload';
import {
  authorizeSnapshotProject,
  notFoundResponse,
  revalidateSnapshotProject,
  snapshotRouteDependencies,
  type SnapshotRouteContext,
  type SnapshotRouteDependencies,
} from '../route-utils';

const MAX_MULTIPART_BYTES = 6 * 1024 * 1024;

type BoundedBodyResult =
  | { ok: true; body: ArrayBuffer }
  | { ok: false };

async function cancelBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (body === null || body.locked) return;
  await body.cancel().catch(() => undefined);
}

async function readBoundedMultipartBody(request: Request): Promise<BoundedBodyResult> {
  const rawLength = request.headers.get('content-length');
  if (rawLength !== null && /^\d+$/.test(rawLength)) {
    const declaredLength = Number(rawLength);
    if (
      !Number.isSafeInteger(declaredLength)
      || declaredLength > MAX_MULTIPART_BYTES
    ) {
      await cancelBody(request.body);
      return { ok: false };
    }
  }
  if (request.body === null) return { ok: true, body: new ArrayBuffer(0) };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_MULTIPART_BYTES) {
        chunks.length = 0;
        await reader.cancel().catch(() => undefined);
        return { ok: false };
      }
      chunks.push(Uint8Array.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  const body = new ArrayBuffer(total);
  const target = new Uint8Array(body);
  let offset = 0;
  for (const chunk of chunks) {
    target.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, body };
}

export function createSnapshotUploadHandler(
  database: Db,
  overrides: Partial<SnapshotRouteDependencies> = { auth: () => auth() },
) {
  const dependencies = snapshotRouteDependencies(overrides);
  return async function POST(
    request: Request,
    context: SnapshotRouteContext,
  ): Promise<Response> {
    const authorized = await authorizeSnapshotProject(database, context, dependencies);
    if (!authorized.ok) return authorized.response;

    let boundedBody: BoundedBodyResult;
    try {
      boundedBody = await readBoundedMultipartBody(request);
    } catch {
      return Response.json({ error: 'Invalid upload' }, { status: 400 });
    }
    if (!boundedBody.ok) {
      return Response.json({ error: 'upload_too_large' }, { status: 413 });
    }

    let formData: FormData;
    try {
      const headers = new Headers(request.headers);
      headers.delete('content-length');
      formData = await new Request(request.url, {
        method: 'POST',
        headers,
        body: boundedBody.body,
      }).formData();
    } catch {
      return Response.json({ error: 'Invalid upload' }, { status: 400 });
    }
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return Response.json({ error: 'Invalid upload' }, { status: 400 });
    }

    let normalized;
    try {
      normalized = await dependencies.normalize(file);
    } catch (error) {
      if (error instanceof SnapshotUploadError) {
        const status = error.code === 'invalid_image' ? 400 : 413;
        return Response.json({ error: error.code }, { status });
      }
      return Response.json({ error: 'upload_failed' }, { status: 500 });
    }

    try {
      await dependencies.saveManual(database, {
        projectId: authorized.project.id,
        imageData: normalized.imageData,
        width: normalized.width,
        height: normalized.height,
        checksum: normalized.checksum,
      });
    } catch (error) {
      if (error instanceof SnapshotProjectNotFoundError) return notFoundResponse();
      throw error;
    }
    revalidateSnapshotProject(dependencies, authorized.project.slug);
    return Response.json({ ok: true }, { status: 201 });
  };
}

export const POST = createSnapshotUploadHandler(db);
