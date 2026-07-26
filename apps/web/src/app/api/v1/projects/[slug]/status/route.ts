import {
  schema,
  type Db,
} from '@deployhub/db';
import {
  countDistinct,
  desc,
  eq,
} from 'drizzle-orm';
import { db } from '../../../../../../lib/db';
import {
  authorizeProjectRead,
  type ProjectRouteContext,
} from '../read-auth';

export function createProjectStatusHandler(database: Db) {
  return async function getProjectStatus(
    request: Request,
    context: ProjectRouteContext,
  ): Promise<Response> {
    const { slug } = await context.params;
    const authorized = await authorizeProjectRead(database, request, slug);
    if (!authorized.ok) return authorized.response;

    const { project } = authorized;
    const [[linkedResources], [latestDraft]] = await Promise.all([
      database
        .select({
          count: countDistinct(schema.componentResources.resourceId),
        })
        .from(schema.componentResources)
        .innerJoin(
          schema.components,
          eq(
            schema.componentResources.componentId,
            schema.components.id,
          ),
        )
        .where(eq(schema.components.projectId, project.id)),
      database
        .select({
          id: schema.projectDrafts.id,
          status: schema.projectDrafts.status,
          createdAt: schema.projectDrafts.createdAt,
        })
        .from(schema.projectDrafts)
        .where(eq(schema.projectDrafts.projectId, project.id))
        .orderBy(desc(schema.projectDrafts.createdAt))
        .limit(1),
    ]);

    return Response.json({
      registered: true,
      slug: project.slug,
      name: project.name,
      status: project.status,
      lifecycle: project.lifecycle,
      componentCount: project.components.length,
      linkedResourceCount: linkedResources?.count ?? 0,
      latestDraft: latestDraft
        ? {
          id: latestDraft.id,
          status: latestDraft.status,
          createdAt: latestDraft.createdAt.toISOString(),
        }
        : null,
      projectUrl: `/projects/${encodeURIComponent(project.slug)}`,
    });
  };
}

export const GET = createProjectStatusHandler(db);
