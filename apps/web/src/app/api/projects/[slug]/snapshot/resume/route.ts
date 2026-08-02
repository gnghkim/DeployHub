import {
  SnapshotProjectNotFoundError,
  type Db,
} from '@deployhub/db';
import { auth } from '../../../../../../auth/config';
import { db } from '../../../../../../lib/db';
import {
  authorizeSnapshotProject,
  notFoundResponse,
  revalidateSnapshotProject,
  snapshotRouteDependencies,
  type SnapshotRouteContext,
  type SnapshotRouteDependencies,
} from '../route-utils';

export function createSnapshotResumeHandler(
  database: Db,
  overrides: Partial<SnapshotRouteDependencies> = { auth: () => auth() },
) {
  const dependencies = snapshotRouteDependencies(overrides);
  return async function POST(
    _request: Request,
    context: SnapshotRouteContext,
  ): Promise<Response> {
    const authorized = await authorizeSnapshotProject(database, context, dependencies);
    if (!authorized.ok) return authorized.response;
    if (authorized.project.snapshotUrl === null) {
      return Response.json({ error: 'Snapshot URL is required' }, { status: 400 });
    }
    if (authorized.project.snapshotMode === 'automatic') {
      return Response.json({ error: 'Automatic capture is already enabled' }, { status: 409 });
    }

    let resumed: boolean;
    try {
      resumed = await dependencies.resumeAutomatic(database, authorized.project.id);
    } catch (error) {
      if (error instanceof SnapshotProjectNotFoundError) return notFoundResponse();
      throw error;
    }

    const current = await dependencies.findProject(database, authorized.project.slug);
    if (!current) return notFoundResponse();
    if (!resumed) {
      if (current.snapshotUrl === null) {
        return Response.json({ error: 'Snapshot URL is required' }, { status: 400 });
      }
      return Response.json({ error: 'Snapshot mode changed' }, { status: 409 });
    }
    if (current.snapshotMode !== 'automatic' || current.snapshotUrl === null) {
      return Response.json({ error: 'Snapshot mode changed' }, { status: 409 });
    }

    const queued = await dependencies.enqueue(database, {
      projectId: current.id,
      url: current.snapshotUrl,
      requestId: dependencies.randomUUID(),
    });
    revalidateSnapshotProject(dependencies, current.slug);
    return Response.json({ queued }, { status: 202 });
  };
}

export const POST = createSnapshotResumeHandler(db);
