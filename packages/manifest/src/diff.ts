import type { Manifest } from './schema';

export type ManifestDiff = {
  project: { field: string; from: string | null; to: string | null }[];
  componentsAdded: string[];
  componentsChanged: {
    name: string;
    field: string;
    from: string | null;
    to: string | null;
  }[];
  componentsRemoved: string[];
  domainsAdded: string[];
  domainsRemoved: string[];
};

export type CurrentProject = {
  name: string;
  slug: string;
  description: string | null;
  lifecycle: string;
  importance: number;
  owner: string | null;
  repository: string | null;
  components: {
    name: string;
    componentType: string;
    framework: string | null;
    runtime: string | null;
    language: string | null;
    criticality: number;
    provider?: string | null;
    externalRef?: string | null;
    containerName?: string | null;
    url?: string | null;
  }[];
  domains?: { domain: string; environment: string }[];
};

const stringValue = (value: string | number | null | undefined): string | null =>
  value === null || value === undefined ? null : String(value);

const domainKey = (domain: { domain: string; environment: string }): string =>
  `${domain.domain} (${domain.environment})`;

export function diffManifest(
  manifest: Manifest,
  current: CurrentProject | undefined,
): ManifestDiff {
  const result: ManifestDiff = {
    project: [],
    componentsAdded: [],
    componentsChanged: [],
    componentsRemoved: [],
    domainsAdded: [],
    domainsRemoved: [],
  };

  if (!current) {
    result.componentsAdded = manifest.spec.components.map(({ name }) => name);
    result.domainsAdded = (manifest.spec.domains ?? []).map(domainKey);
    return result;
  }

  const projectFields = [
    ['name', current.name, manifest.metadata.name],
    ['slug', current.slug, manifest.metadata.slug],
    ['description', current.description, manifest.metadata.description],
    ['lifecycle', current.lifecycle, manifest.spec.lifecycle],
    ['importance', current.importance, manifest.spec.importance ?? 3],
    ['owner', current.owner, manifest.spec.owner],
    ['repository', current.repository, manifest.spec.repository?.slug],
  ] as const;

  for (const [field, from, to] of projectFields) {
    const fromValue = stringValue(from);
    const toValue = stringValue(to);
    if (fromValue !== toValue) {
      result.project.push({ field, from: fromValue, to: toValue });
    }
  }

  const currentComponents = new Map(
    current.components.map((component) => [component.name, component]),
  );
  const manifestComponents = new Map(
    manifest.spec.components.map((component) => [component.name, component]),
  );

  for (const component of manifest.spec.components) {
    const existing = currentComponents.get(component.name);
    if (!existing) {
      result.componentsAdded.push(component.name);
      continue;
    }

    const componentFields = [
      ['type', existing.componentType, component.type],
      ['framework', existing.framework, component.framework],
      ['runtime', existing.runtime, component.runtime],
      ['language', existing.language, component.language],
      ['criticality', existing.criticality, component.criticality ?? 3],
      ['provider', existing.provider, component.provider],
      ['externalRef', existing.externalRef, component.externalRef],
      ['container', existing.containerName, component.container],
      ['url', existing.url, component.url],
    ] as const;

    for (const [field, from, to] of componentFields) {
      const fromValue = stringValue(from);
      const toValue = stringValue(to);
      if (fromValue !== toValue) {
        result.componentsChanged.push({
          name: component.name,
          field,
          from: fromValue,
          to: toValue,
        });
      }
    }
  }

  result.componentsRemoved = current.components
    .filter(({ name }) => !manifestComponents.has(name))
    .map(({ name }) => name);

  const currentDomains = new Set((current.domains ?? []).map(domainKey));
  const manifestDomains = new Set((manifest.spec.domains ?? []).map(domainKey));
  result.domainsAdded = [...manifestDomains].filter(
    (domain) => !currentDomains.has(domain),
  );
  result.domainsRemoved = [...currentDomains].filter(
    (domain) => !manifestDomains.has(domain),
  );

  return result;
}
