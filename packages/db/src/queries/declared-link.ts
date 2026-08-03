import {
  and,
  eq,
  inArray,
  isNull,
} from 'drizzle-orm';
import type { Db } from '../client';
import {
  components,
  projects,
} from '../schema/projects';
import {
  componentResources,
  resources,
} from '../schema/resources';

export type DeclaredComponent = {
  id: string;
  projectId: string;
  projectSlug: string;
  name: string;
  slug: string;
  provider: string | null;
  externalRef: string | null;
  containerName: string | null;
};

export type ObservedResource = {
  id: string;
  provider: string;
  resourceType: string;
  externalId: string;
  name: string;
  metadata: unknown;
};

export type ExistingResourceLink = {
  componentId: string;
  linkedBy: 'manifest' | 'label' | 'repository' | 'user' | 'suggested';
};

export type DeclaredLink = {
  componentId: string;
  linkedBy: 'manifest' | 'label';
  environment: string;
};

export type DeclaredLinkDecision =
  | {
    kind: 'links';
    links: DeclaredLink[];
  }
  | {
    kind: 'conflict';
    containerName: string;
    manifestComponentId: string;
    manifestComponentName: string;
    labelComponentId: string;
    labelComponentName: string;
  }
  | {
    kind: 'none';
    reason: 'no_match' | 'user_link';
  };

type LinkDb = Pick<Db, 'delete' | 'insert' | 'select'>;

export type LinkDeclaredResourcesInput = {
  provider: 'docker' | 'vercel' | 'supabase';
  externalIds?: string[];
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function only<T>(values: T[]): T | null {
  return values.length === 1 ? values[0]! : null;
}

export function resolveDeclaredLink(
  resource: ObservedResource,
  components: DeclaredComponent[],
  existingLinks: ExistingResourceLink[],
): DeclaredLinkDecision {
  if (existingLinks.some((link) => link.linkedBy === 'user')) {
    return { kind: 'none', reason: 'user_link' };
  }

  if (
    resource.provider === 'supabase'
    && resource.resourceType === 'supabase_project'
  ) {
    const matches = components.filter((component) => (
      component.provider === 'supabase'
      && component.externalRef === resource.externalId
    ));
    return matches.length === 0
      ? { kind: 'none', reason: 'no_match' }
      : {
        kind: 'links',
        links: matches.map((component) => ({
          componentId: component.id,
          linkedBy: 'manifest',
          environment: 'production',
        })),
      };
  }

  if (
    resource.provider === 'vercel'
    && resource.resourceType === 'vercel_project'
  ) {
    const manifestComponent = only(components.filter((component) => (
      component.provider === 'vercel'
      && component.externalRef === resource.externalId
    )));
    return manifestComponent === null
      ? { kind: 'none', reason: 'no_match' }
      : {
        kind: 'links',
        links: [{
          componentId: manifestComponent.id,
          linkedBy: 'manifest',
          environment: 'production',
        }],
      };
  }

  if (
    resource.provider !== 'docker'
    || resource.resourceType !== 'docker_container'
  ) {
    return { kind: 'none', reason: 'no_match' };
  }

  const manifestComponent = only(components.filter((component) => (
    component.containerName === resource.name
  )));
  const labels = record(record(resource.metadata).labels);
  const labelProject = stringValue(labels['deployhub.project']);
  const labelComponentName = stringValue(
    labels['deployhub.component'],
  );
  const labelComponent = labelComponentName === null
    ? null
    : only(components.filter((component) => (
      (labelProject === null || component.projectSlug === labelProject)
      && (
        component.name === labelComponentName
        || component.slug === labelComponentName
      )
    )));

  if (
    manifestComponent !== null
    && labelComponent !== null
    && manifestComponent.id !== labelComponent.id
  ) {
    return {
      kind: 'conflict',
      containerName: resource.name,
      manifestComponentId: manifestComponent.id,
      manifestComponentName: manifestComponent.name,
      labelComponentId: labelComponent.id,
      labelComponentName: labelComponent.name,
    };
  }

  const component = manifestComponent ?? labelComponent;
  if (component === null) {
    return { kind: 'none', reason: 'no_match' };
  }

  const environment = stringValue(
    labels['deployhub.environment'],
  ) ?? 'production';
  return {
    kind: 'links',
    links: [{
      componentId: component.id,
      linkedBy: manifestComponent === null ? 'label' : 'manifest',
      environment,
    }],
  };
}

export async function linkDeclaredResources(
  db: LinkDb,
  input: LinkDeclaredResourcesInput,
): Promise<void> {
  if (input.externalIds?.length === 0) return;

  const resourceConditions = [
    eq(resources.provider, input.provider),
    isNull(resources.deletedAt),
  ];
  if (input.externalIds !== undefined) {
    resourceConditions.push(
      inArray(resources.externalId, input.externalIds),
    );
  }

  const observed = await db
    .select({
      id: resources.id,
      provider: resources.provider,
      resourceType: resources.resourceType,
      externalId: resources.externalId,
      name: resources.name,
      metadata: resources.metadata,
    })
    .from(resources)
    .where(and(...resourceConditions));
  if (observed.length === 0) return;

  const declarations = await db
    .select({
      id: components.id,
      projectId: components.projectId,
      projectSlug: projects.slug,
      name: components.name,
      slug: components.slug,
      provider: components.provider,
      externalRef: components.externalRef,
      containerName: components.containerName,
    })
    .from(components)
    .innerJoin(projects, eq(projects.id, components.projectId));
  const resourceIds = observed.map((resource) => resource.id);
  const existing = await db
    .select({
      resourceId: componentResources.resourceId,
      componentId: componentResources.componentId,
      linkedBy: componentResources.linkedBy,
    })
    .from(componentResources)
    .where(inArray(componentResources.resourceId, resourceIds));
  const linksByResource = new Map<string, ExistingResourceLink[]>();
  for (const link of existing) {
    const links = linksByResource.get(link.resourceId) ?? [];
    links.push({
      componentId: link.componentId,
      linkedBy: link.linkedBy,
    });
    linksByResource.set(link.resourceId, links);
  }

  for (const resource of observed) {
    const decision = resolveDeclaredLink(
      resource,
      declarations,
      linksByResource.get(resource.id) ?? [],
    );
    if (decision.kind === 'none' && decision.reason === 'user_link') {
      continue;
    }

    await db
      .delete(componentResources)
      .where(
        and(
          eq(componentResources.resourceId, resource.id),
          inArray(componentResources.linkedBy, ['manifest', 'label']),
        ),
      );
    if (decision.kind !== 'links') continue;

    for (const link of decision.links) {
      await db
        .insert(componentResources)
        .values({
          componentId: link.componentId,
          resourceId: resource.id,
          environment: link.environment,
          relationType: 'deployed_to',
          isPrimary: true,
          linkedBy: link.linkedBy,
        })
        .onConflictDoNothing({
          target: [
            componentResources.componentId,
            componentResources.resourceId,
            componentResources.environment,
          ],
        });
    }
  }
}
