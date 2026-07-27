import { describe, expect, it } from 'vitest';
import type { Manifest } from './schema';
import { diffManifest, type CurrentProject } from './diff';

const manifest = (overrides: Partial<Manifest> = {}): Manifest => ({
  apiVersion: 'deployhub.io/v1',
  kind: 'Project',
  metadata: {
    name: 'DeployHub',
    slug: 'deployhub',
    description: 'Infrastructure inventory',
  },
  spec: {
    lifecycle: 'production',
    importance: 4,
    owner: 'platform',
    repository: {
      provider: 'github',
      slug: 'ktgo/deployhub',
    },
    components: [
      {
        name: 'web',
        type: 'frontend',
        framework: 'nextjs',
        runtime: 'nodejs',
        language: 'typescript',
        criticality: 4,
        path: 'apps/web',
        provider: 'supabase',
        externalRef: 'abcdefghijklmnop',
      },
      {
        name: 'worker',
        type: 'worker',
        runtime: 'nodejs',
        language: 'typescript',
        criticality: 3,
        path: 'apps/worker',
      },
    ],
    domains: [
      { domain: 'hub.example.com', environment: 'production' },
    ],
  },
  ...overrides,
});

const currentProject = (
  overrides: Partial<CurrentProject> = {},
): CurrentProject => ({
  name: 'DeployHub',
  slug: 'deployhub',
  description: 'Infrastructure inventory',
  lifecycle: 'production',
  importance: 4,
  owner: 'platform',
  repository: 'ktgo/deployhub',
  components: [
    {
      name: 'web',
      componentType: 'frontend',
      framework: 'nextjs',
      runtime: 'nodejs',
      language: 'typescript',
      criticality: 4,
      provider: 'supabase',
      externalRef: 'abcdefghijklmnop',
      containerName: null,
      url: null,
    },
    {
      name: 'worker',
      componentType: 'worker',
      framework: null,
      runtime: 'nodejs',
      language: 'typescript',
      criticality: 3,
    },
  ],
  domains: [
    { domain: 'hub.example.com', environment: 'production' },
  ],
  ...overrides,
});

describe('diffManifest', () => {
  it('marks every component and domain as added for a new project', () => {
    expect(diffManifest(manifest(), undefined)).toEqual({
      project: [],
      componentsAdded: ['web', 'worker'],
      componentsChanged: [],
      componentsRemoved: [],
      domainsAdded: ['hub.example.com (production)'],
      domainsRemoved: [],
    });
  });

  it('reports changed project and component fields with from/to values', () => {
    const current = currentProject({
      description: 'Old description',
      components: [
        {
          ...currentProject().components[0]!,
          framework: 'react',
        },
        currentProject().components[1]!,
      ],
    });

    expect(diffManifest(manifest(), current)).toMatchObject({
      project: [
        {
          field: 'description',
          from: 'Old description',
          to: 'Infrastructure inventory',
        },
      ],
      componentsChanged: [
        {
          name: 'web',
          field: 'framework',
          from: 'react',
          to: 'nextjs',
        },
      ],
    });
  });

  it('reports provider changes in componentsChanged', () => {
    const changedProvider = manifest();
    changedProvider.spec.components[0]!.provider = 'neon';

    expect(diffManifest(changedProvider, currentProject())).toMatchObject({
      componentsChanged: [
        {
          name: 'web',
          field: 'provider',
          from: 'supabase',
          to: 'neon',
        },
      ],
    });
  });

  it('marks existing components and domains missing from the manifest as removed', () => {
    const current = currentProject({
      components: [
        ...currentProject().components,
        {
          ...currentProject().components[0]!,
          name: 'api',
          componentType: 'api',
        },
      ],
      domains: [
        ...(currentProject().domains ?? []),
        { domain: 'old.example.com', environment: 'preview' },
      ],
    });

    expect(diffManifest(manifest(), current)).toMatchObject({
      componentsRemoved: ['api'],
      domainsRemoved: ['old.example.com (preview)'],
    });
  });

  it('returns empty arrays when the manifest matches the current project', () => {
    expect(diffManifest(manifest(), currentProject())).toEqual({
      project: [],
      componentsAdded: [],
      componentsChanged: [],
      componentsRemoved: [],
      domainsAdded: [],
      domainsRemoved: [],
    });
  });

  it('does not report a change when only component order differs', () => {
    const reversed = manifest();
    reversed.spec.components = [...reversed.spec.components].reverse();

    expect(diffManifest(reversed, currentProject())).toEqual({
      project: [],
      componentsAdded: [],
      componentsChanged: [],
      componentsRemoved: [],
      domainsAdded: [],
      domainsRemoved: [],
    });
  });
});
