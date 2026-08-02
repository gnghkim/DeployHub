import type { Db } from '@deployhub/db';
import { auth } from '../../../../../../auth/config';
import { db } from '../../../../../../lib/db';
import {
  authorizeSnapshotProject,
  revalidateSnapshotProject,
  snapshotRouteDependencies,
  type SnapshotRouteContext,
  type SnapshotRouteDependencies,
} from '../route-utils';

export function createSnapshotCaptureHandler(
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
    const { project } = authorized;
    if (project.snapshotMode !== 'automatic' || project.snapshotUrl === null) {
      return Response.json({ error: 'Automatic capture is not enabled' }, { status: 409 });
    }

    const queued = await dependencies.enqueue(database, {
      projectId: project.id,
      url: project.snapshotUrl,
      requestId: dependencies.randomUUID(),
    });
    revalidateSnapshotProject(dependencies, project.slug);
    return Response.json({ queued }, { status: 202 });
  };
}

export const POST = createSnapshotCaptureHandler(db);
