import {
  getProjectBySlug,
  verifyToken,
  type Db,
  type ProjectDetail,
} from '@deployhub/db';
import { bearerToken } from '../../../../../lib/token';

export type ProjectRouteContext = {
  params: Promise<{ slug: string }>;
};

type AuthorizedProject =
  | {
    ok: true;
    project: ProjectDetail;
  }
  | {
    ok: false;
    response: Response;
  };

export async function authorizeProjectRead(
  database: Db,
  request: Request,
  slug: string,
): Promise<AuthorizedProject> {
  const rawToken = bearerToken(request);
  if (!rawToken) {
    return {
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const verified = await verifyToken(database, rawToken);
  if (!verified.ok || verified.scope !== 'project:draft:create') {
    return {
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  if (
    verified.projectSlugConstraint
    && verified.projectSlugConstraint !== slug
  ) {
    return {
      ok: false,
      response: Response.json(
        { error: 'Project not allowed' },
        { status: 403 },
      ),
    };
  }

  const project = await getProjectBySlug(database, slug);
  if (!project) {
    return {
      ok: false,
      response: Response.json({ error: 'Not found' }, { status: 404 }),
    };
  }

  if (
    verified.repositoryConstraint
    && verified.repositoryConstraint !== project.repository
  ) {
    return {
      ok: false,
      response: Response.json(
        { error: 'Repository not allowed' },
        { status: 403 },
      ),
    };
  }

  return { ok: true, project };
}
