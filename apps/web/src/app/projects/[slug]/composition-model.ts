import {
  describeMissingObservation,
  type ObservationContext,
} from './observation-state';

export type CompositionComponentInput = {
  id: string;
  name: string;
  componentType: string;
  framework: string | null;
  runtime: string | null;
  language: string | null;
  provider: string | null;
  externalRef: string | null;
  containerName: string | null;
  updatedAt: Date;
};

export type CompositionResourceInput = {
  id: string;
  componentId: string;
  provider: string;
  resourceType: string;
  name: string;
  status: string | null;
};

export type CompositionInput = {
  components: CompositionComponentInput[];
  resources: CompositionResourceInput[];
  observationContext: ObservationContext;
};

export type CompositionObservation = {
  key: string;
  name: string | null;
  provider: string | null;
  status: string | null;
  message: string | null;
};

export type CompositionRow = {
  key: string;
  declaration: {
    name: string;
    technology: string;
  };
  observations: CompositionObservation[];
};

export type Composition = {
  rows: CompositionRow[];
};

const COMPONENT_ORDER: Record<string, number> = {
  frontend: 0,
  backend: 1,
  api: 2,
  worker: 3,
  scheduler: 4,
  database: 5,
  authentication: 6,
  storage: 7,
  cache: 8,
  queue: 9,
  monitoring: 10,
};

const TECHNOLOGY_NAMES: Record<string, string> = {
  nextjs: 'Next.js',
  react: 'React',
  fastapi: 'FastAPI',
  express: 'Express',
  nodejs: 'Node',
  python: 'Python',
  postgresql: 'PostgreSQL',
  typescript: 'TypeScript',
  javascript: 'JavaScript',
};

const OUTER_NODE_RESOURCE_TYPES = new Set([
  'github_repository',
  'domain',
]);

export function isComponentObservationResource({
  resourceType,
}: {
  resourceType: string;
}): boolean {
  return !OUTER_NODE_RESOURCE_TYPES.has(resourceType);
}

function technologyName(component: CompositionComponentInput): string {
  const value = component.framework
    ?? component.runtime
    ?? component.language;
  if (!value) return '—';
  return TECHNOLOGY_NAMES[value] ?? value;
}

function compareComponents(
  left: CompositionComponentInput,
  right: CompositionComponentInput,
): number {
  const byType = (COMPONENT_ORDER[left.componentType] ?? Number.MAX_SAFE_INTEGER)
    - (COMPONENT_ORDER[right.componentType] ?? Number.MAX_SAFE_INTEGER);
  if (byType !== 0) return byType;
  const byName = left.name.localeCompare(right.name, 'en');
  return byName !== 0 ? byName : left.id.localeCompare(right.id, 'en');
}

function compareResources(
  left: CompositionResourceInput,
  right: CompositionResourceInput,
): number {
  return left.provider.localeCompare(right.provider, 'en')
    || left.name.localeCompare(right.name, 'en')
    || left.id.localeCompare(right.id, 'en');
}

export function buildComposition({
  components,
  resources,
  observationContext,
}: CompositionInput): Composition {
  const rows = [...components].sort(compareComponents).map((component) => {
    const observed = resources
      .filter((resource) => (
        resource.componentId === component.id
        && isComponentObservationResource(resource)
      ))
      .sort(compareResources)
      .map((resource): CompositionObservation => ({
        key: resource.id,
        name: resource.name,
        provider: resource.provider,
        status: resource.status,
        message: null,
      }));

    const missing = describeMissingObservation(
      component,
      observationContext,
    );

    return {
      key: component.id,
      declaration: {
        name: component.name,
        technology: technologyName(component),
      },
      observations: observed.length > 0
        ? observed
        : [{
          key: `${component.id}:unobserved`,
          name: null,
          provider: null,
          status: null,
          message: missing.detail === null
            ? missing.label
            : `${missing.label} · ${missing.detail}`,
        }],
    };
  });

  return { rows };
}
