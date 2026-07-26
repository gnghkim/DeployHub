import type { Db } from '@deployhub/db';
import { MANIFEST_VERSION } from '@deployhub/manifest';
import { db } from '../../../../../../lib/db';
import {
  authorizeProjectRead,
  type ProjectRouteContext,
} from '../read-auth';

const VERSION_HEADERS = {
  'X-Manifest-Version': MANIFEST_VERSION,
};

export function createProjectManifestHandler(database: Db) {
  return async function getProjectManifest(
    request: Request,
    context: ProjectRouteContext,
  ): Promise<Response> {
    const { slug } = await context.params;
    const authorized = await authorizeProjectRead(database, request, slug);
    if (!authorized.ok) {
      authorized.response.headers.set(
        'X-Manifest-Version',
        MANIFEST_VERSION,
      );
      return authorized.response;
    }

    const { project } = authorized;
    return Response.json(
      {
        project: {
          name: project.name,
          slug: project.slug,
          description: project.description,
          lifecycle: project.lifecycle,
          importance: project.importance,
          owner: project.owner,
          repository: project.repository,
          components: project.components.map((component) => ({
            name: component.name,
            componentType: component.componentType,
            framework: component.framework,
            runtime: component.runtime,
            language: component.language,
            criticality: component.criticality,
          })),
          domains: project.domains.map((domain) => ({
            domain: domain.domain,
            environment: domain.environment,
          })),
        },
      },
      { headers: VERSION_HEADERS },
    );
  };
}

export const GET = createProjectManifestHandler(db);
