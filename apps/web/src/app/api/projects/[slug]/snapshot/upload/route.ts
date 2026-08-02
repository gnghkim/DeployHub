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

    let formData: FormData;
    try {
      formData = await request.formData();
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
      return Response.json({ error: 'invalid_image' }, { status: 400 });
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
