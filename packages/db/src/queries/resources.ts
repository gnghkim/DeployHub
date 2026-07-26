import {
  and,
  asc,
  eq,
  isNull,
  ne,
} from 'drizzle-orm';
import type { Db } from '../client';
import {
  componentResources,
  resources,
} from '../schema/resources';
import {
  components,
  projects,
} from '../schema/projects';

export type ResourceLinkRow = {
  linkId: string;
  componentId: string;
  componentName: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
  environment: string;
  relationType: typeof componentResources.$inferSelect.relationType;
  linkedBy: typeof componentResources.$inferSelect.linkedBy;
};

export type ResourceRow = typeof resources.$inferSelect & {
  links: ResourceLinkRow[];
};

export type ProjectResourceRow = Omit<ResourceRow, 'links'> & ResourceLinkRow;

export async function listResources(db: Db): Promise<ResourceRow[]> {
  const rows = await db
    .select({
      id: resources.id,
      provider: resources.provider,
      providerAccountId: resources.providerAccountId,
      externalId: resources.externalId,
      resourceType: resources.resourceType,
      name: resources.name,
      status: resources.status,
      region: resources.region,
      url: resources.url,
      metadata: resources.metadata,
      firstSeenAt: resources.firstSeenAt,
      lastSeenAt: resources.lastSeenAt,
      deletedAt: resources.deletedAt,
      linkId: componentResources.id,
      componentId: componentResources.componentId,
      componentName: components.name,
      projectId: projects.id,
      projectName: projects.name,
      projectSlug: projects.slug,
      environment: componentResources.environment,
      relationType: componentResources.relationType,
      linkedBy: componentResources.linkedBy,
    })
    .from(resources)
    .leftJoin(
      componentResources,
      and(
        eq(componentResources.resourceId, resources.id),
        ne(componentResources.linkedBy, 'suggested'),
      ),
    )
    .leftJoin(
      components,
      eq(components.id, componentResources.componentId),
    )
    .leftJoin(projects, eq(projects.id, components.projectId))
    .where(isNull(resources.deletedAt))
    .orderBy(asc(resources.name), asc(components.name));

  const grouped = new Map<string, ResourceRow>();
  for (const row of rows) {
    let resource = grouped.get(row.id);
    if (!resource) {
      resource = {
        id: row.id,
        provider: row.provider,
        providerAccountId: row.providerAccountId,
        externalId: row.externalId,
        resourceType: row.resourceType,
        name: row.name,
        status: row.status,
        region: row.region,
        url: row.url,
        metadata: row.metadata,
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
        deletedAt: row.deletedAt,
        links: [],
      };
      grouped.set(row.id, resource);
    }

    if (
      row.linkId
      && row.componentId
      && row.componentName
      && row.projectId
      && row.projectName
      && row.projectSlug
      && row.environment
      && row.relationType
      && row.linkedBy
    ) {
      resource.links.push({
        linkId: row.linkId,
        componentId: row.componentId,
        componentName: row.componentName,
        projectId: row.projectId,
        projectName: row.projectName,
        projectSlug: row.projectSlug,
        environment: row.environment,
        relationType: row.relationType,
        linkedBy: row.linkedBy,
      });
    }
  }

  return [...grouped.values()];
}

export async function listUnlinkedResources(db: Db): Promise<ResourceRow[]> {
  return (await listResources(db)).filter((resource) => (
    resource.links.length === 0
  ));
}

export async function listProjectResources(
  db: Db,
  projectId: string,
): Promise<ProjectResourceRow[]> {
  return (await listResources(db)).flatMap(({ links, ...resource }) => (
    links
      .filter((link) => link.projectId === projectId)
      .map((link) => ({ ...resource, ...link }))
  ));
}
