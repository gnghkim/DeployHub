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
import { readBoundedBody } from '../bounded-body';

const MAX_MULTIPART_BYTES = 6 * 1024 * 1024;
const BODY_READ_TIMEOUT_MS = 10_000;

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

    const boundedBody = await readBoundedBody(request.body, {
      maximumBytes: MAX_MULTIPART_BYTES,
      timeoutMs: BODY_READ_TIMEOUT_MS,
      declaredLength: request.headers.get('content-length'),
      signal: request.signal,
    });
    if (!boundedBody.ok) {
      if (boundedBody.reason === 'too_large') {
        return Response.json({ error: 'upload_too_large' }, { status: 413 });
      }
      if (boundedBody.reason === 'timeout' || boundedBody.reason === 'aborted') {
        return Response.json({ error: 'upload_timeout' }, { status: 408 });
      }
      return Response.json({ error: 'Invalid upload' }, { status: 400 });
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
