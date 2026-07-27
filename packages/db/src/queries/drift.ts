import {
  and,
  eq,
  inArray,
  isNull,
  ne,
  or,
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
import {
  resolveDeclaredLink,
  type DeclaredComponent,
  type ObservedResource,
} from './declared-link';

export type DriftKind =
  | 'declared_not_observed'
  | 'observed_not_declared'
  | 'image_mismatch'
  | 'provider_mismatch'
  | 'link_conflict';

export type Drift = {
  kind: DriftKind;
  projectId: string;
  componentId: string | null;
  declared: string | null;
  observed: string | null;
  detail: string;
};

export async function computeDrift(
  db: Db,
  projectId: string,
): Promise<Drift[]> {
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
  const projectComponents = declarations.filter(
    (component) => component.projectId === projectId,
  );
  if (projectComponents.length === 0) return [];

  const linkedResources = await db
    .select({
      componentId: components.id,
      componentName: components.name,
      declaredProvider: components.provider,
      externalRef: components.externalRef,
      containerName: components.containerName,
      resourceId: resources.id,
      resourceProvider: resources.provider,
      resourceType: resources.resourceType,
      externalId: resources.externalId,
      resourceName: resources.name,
      metadata: resources.metadata,
    })
    .from(componentResources)
    .innerJoin(
      components,
      eq(components.id, componentResources.componentId),
    )
    .innerJoin(
      resources,
      eq(resources.id, componentResources.resourceId),
    )
    .where(
      and(
        eq(components.projectId, projectId),
        ne(componentResources.linkedBy, 'suggested'),
        isNull(resources.deletedAt),
      ),
    );

  const containerNames = projectComponents.flatMap((component) => (
    component.containerName === null ? [] : [component.containerName]
  ));
  const vercelRefs = projectComponents.flatMap((component) => (
    component.provider === 'vercel' && component.externalRef !== null
      ? [component.externalRef]
      : []
  ));
  const declaredConditions = [];
  if (containerNames.length > 0) {
    declaredConditions.push(
      and(
        eq(resources.provider, 'docker'),
        eq(resources.resourceType, 'docker_container'),
        inArray(resources.name, containerNames),
      ),
    );
  }
  if (vercelRefs.length > 0) {
    declaredConditions.push(
      and(
        eq(resources.provider, 'vercel'),
        eq(resources.resourceType, 'vercel_project'),
        inArray(resources.externalId, vercelRefs),
      ),
    );
  }
  const declaredResources = declaredConditions.length === 0
    ? []
    : await db
      .select({
        id: resources.id,
        provider: resources.provider,
        resourceType: resources.resourceType,
        externalId: resources.externalId,
        name: resources.name,
        metadata: resources.metadata,
      })
      .from(resources)
      .where(
        and(
          isNull(resources.deletedAt),
          or(...declaredConditions),
        ),
      );

  const drift: Drift[] = [];
  const conflictComponents = new Set<string>();
  for (const resource of declaredResources) {
    const decision = resolveDeclaredLink(
      resource as ObservedResource,
      declarations as DeclaredComponent[],
      [],
    );
    if (
      decision.kind !== 'conflict'
      || !projectComponents.some(
        (component) => component.id === decision.manifestComponentId,
      )
    ) {
      continue;
    }

    conflictComponents.add(decision.manifestComponentId);
    drift.push({
      kind: 'link_conflict',
      projectId,
      componentId: decision.manifestComponentId,
      declared: decision.manifestComponentName,
      observed: decision.labelComponentName,
      detail:
        `컨테이너 ${decision.containerName}: manifest 구성요소 `
        + `${decision.manifestComponentName}와 Docker 라벨 구성요소 `
        + `${decision.labelComponentName}가 충돌합니다.`,
    });
  }

  for (const component of projectComponents) {
    if (
      component.containerName !== null
      && !conflictComponents.has(component.id)
      && !declaredResources.some((resource) => (
        resource.provider === 'docker'
        && resource.resourceType === 'docker_container'
        && resource.name === component.containerName
      ))
    ) {
      drift.push({
        kind: 'declared_not_observed',
        projectId,
        componentId: component.id,
        declared: component.containerName,
        observed: null,
        detail:
          `manifest 컨테이너 ${component.containerName}가 관측되지 않았습니다.`,
      });
    }

    if (
      component.provider === 'vercel'
      && component.externalRef !== null
      && !declaredResources.some((resource) => (
        resource.provider === 'vercel'
        && resource.resourceType === 'vercel_project'
        && resource.externalId === component.externalRef
      ))
    ) {
      drift.push({
        kind: 'declared_not_observed',
        projectId,
        componentId: component.id,
        declared: component.externalRef,
        observed: null,
        detail:
          `manifest Vercel 참조 ${component.externalRef}가 관측되지 않았습니다.`,
      });
    }
  }

  for (const resource of linkedResources) {
    const expectedProvider = directlyObservedProvider(
      resource.declaredProvider,
    );
    if (
      expectedProvider !== null
      && expectedProvider !== resource.resourceProvider
    ) {
      drift.push({
        kind: 'provider_mismatch',
        projectId,
        componentId: resource.componentId,
        declared: resource.declaredProvider,
        observed: resource.resourceProvider,
        detail:
          `구성요소 ${resource.componentName}의 선언 provider `
          + `${resource.declaredProvider}와 관측 provider `
          + `${resource.resourceProvider}가 다릅니다.`,
      });
    }

    const declared = resourceMatchesDeclaration(resource);
    if (declared === false) {
      drift.push({
        kind: 'observed_not_declared',
        projectId,
        componentId: resource.componentId,
        declared: null,
        observed: resource.resourceType === 'docker_container'
          ? resource.resourceName
          : resource.externalId,
        detail:
          `연결된 ${resource.resourceName} 자원이 manifest에 선언되지 않았습니다.`,
      });
    }
  }

  return drift;
}

function directlyObservedProvider(provider: string | null): string | null {
  return provider === 'docker'
    || provider === 'vercel'
    || provider === 'supabase'
    || provider === 'github'
    ? provider
    : null;
}

function resourceMatchesDeclaration(resource: {
  resourceType: string;
  resourceName: string;
  externalId: string;
  declaredProvider: string | null;
  externalRef: string | null;
  containerName: string | null;
}): boolean | null {
  if (resource.resourceType === 'docker_container') {
    return resource.containerName === resource.resourceName;
  }
  if (resource.resourceType === 'vercel_project') {
    return resource.declaredProvider === 'vercel'
      && resource.externalRef === resource.externalId;
  }
  return null;
}
