import {
  SnapshotProjectNotFoundError,
  type Db,
} from '@deployhub/db';
import { auth } from '../../../../../auth/config';
import { db } from '../../../../../lib/db';
import {
  authorizeSnapshotProject,
  notFoundResponse,
  revalidateSnapshotProject,
  snapshotRouteDependencies,
  type SnapshotRouteContext,
  type SnapshotRouteDependencies,
} from './route-utils';

const PRIVATE_IMAGE_HEADERS = {
  'Cache-Control': 'private, max-age=0, must-revalidate',
  'Content-Type': 'image/webp',
};

function matchesEtag(header: string | null, etag: string): boolean {
  if (header === null) return false;
  return header.split(',').some((candidate) => {
    const value = candidate.trim();
    return value === etag || value === `W/${etag}` || value === '*';
  });
}

export function createProjectSnapshotHandlers(
  database: Db,
  overrides: Partial<SnapshotRouteDependencies> = { auth: () => auth() },
) {
  const dependencies = snapshotRouteDependencies(overrides);

  async function GET(
    request: Request,
    context: SnapshotRouteContext,
  ): Promise<Response> {
    const authorized = await authorizeSnapshotProject(database, context, dependencies);
    if (!authorized.ok) return authorized.response;

    const snapshot = await dependencies.getSnapshot(database, authorized.project.id);
    if (
      !snapshot?.imageData
      || snapshot.contentType !== 'image/webp'
      || typeof snapshot.checksum !== 'string'
      || snapshot.checksum.length === 0
    ) {
      return notFoundResponse();
    }

    const etag = `"${snapshot.checksum}"`;
    const headers = { ...PRIVATE_IMAGE_HEADERS, ETag: etag };
    if (matchesEtag(request.headers.get('if-none-match'), etag)) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(Uint8Array.from(snapshot.imageData), { headers });
  }

  async function DELETE(
    _request: Request,
    context: SnapshotRouteContext,
  ): Promise<Response> {
    const authorized = await authorizeSnapshotProject(database, context, dependencies);
    if (!authorized.ok) return authorized.response;
    try {
      await dependencies.deleteImage(database, authorized.project.id);
    } catch (error) {
      if (error instanceof SnapshotProjectNotFoundError) return notFoundResponse();
      throw error;
    }
    revalidateSnapshotProject(dependencies, authorized.project.slug);
    return new Response(null, { status: 204 });
  }

  return { GET, DELETE };
}

const handlers = createProjectSnapshotHandlers(db);
export const GET = handlers.GET;
export const DELETE = handlers.DELETE;
