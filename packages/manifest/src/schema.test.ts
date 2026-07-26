import { describe, expect, it } from 'vitest';
import { manifestSchema } from './schema';

const base = {
  apiVersion: 'deployhub.io/v1',
  kind: 'Project',
  metadata: { name: 'DeployHub', slug: 'deployhub' },
  spec: {
    lifecycle: 'production',
    components: [{ name: 'web', type: 'frontend' }],
  },
};

describe('manifestSchema', () => {
  it('accepts the minimal valid manifest', () => {
    expect(manifestSchema.parse(base).metadata.slug).toBe('deployhub');
  });

  it('rejects an unsupported apiVersion', () => {
    expect(() =>
      manifestSchema.parse({ ...base, apiVersion: 'deployhub.io/v2' }),
    ).toThrow();
  });

  it('rejects a kind other than Project', () => {
    expect(() => manifestSchema.parse({ ...base, kind: 'Service' })).toThrow();
  });

  it('trims surrounding whitespace from strings', () => {
    const manifest = manifestSchema.parse({
      ...base,
      metadata: {
        name: '  DeployHub  ',
        slug: 'deployhub',
        description: '  설명  ',
      },
    });

    expect(manifest.metadata.name).toBe('DeployHub');
    expect(manifest.metadata.description).toBe('설명');
  });

  it('rejects a whitespace-only name', () => {
    expect(() =>
      manifestSchema.parse({
        ...base,
        metadata: { name: '   ', slug: 'deployhub' },
      }),
    ).toThrow();
  });

  it('only permits lowercase letters, numbers, and hyphens in slug', () => {
    expect(() =>
      manifestSchema.parse({
        ...base,
        metadata: { name: 'X', slug: 'Deploy_Hub' },
      }),
    ).toThrow();
  });

  it('rejects an empty components array', () => {
    expect(() =>
      manifestSchema.parse({
        ...base,
        spec: { ...base.spec, components: [] },
      }),
    ).toThrow();
  });

  it('requires component names to follow the slug format', () => {
    expect(() =>
      manifestSchema.parse({
        ...base,
        spec: {
          ...base.spec,
          components: [{ name: 'Web App', type: 'frontend' }],
        },
      }),
    ).toThrow();
  });

  it('rejects duplicate component names', () => {
    expect(() =>
      manifestSchema.parse({
        ...base,
        spec: {
          ...base.spec,
          components: [
            { name: 'web', type: 'frontend' },
            { name: 'web', type: 'api' },
          ],
        },
      }),
    ).toThrow();
  });

  it('only permits the 11 DB component types', () => {
    expect(() =>
      manifestSchema.parse({
        ...base,
        spec: {
          ...base.spec,
          components: [{ name: 'gw', type: 'gateway' }],
        },
      }),
    ).toThrow();

    for (const type of [
      'frontend',
      'backend',
      'api',
      'worker',
      'scheduler',
      'database',
      'authentication',
      'storage',
      'cache',
      'queue',
      'monitoring',
    ]) {
      expect(() =>
        manifestSchema.parse({
          ...base,
          spec: {
            ...base.spec,
            components: [{ name: 'c', type }],
          },
        }),
      ).not.toThrow();
    }
  });

  it('requires repository.slug to use the owner/name format', () => {
    const withRepository = (slug: string) =>
      manifestSchema.parse({
        ...base,
        spec: {
          ...base.spec,
          repository: { provider: 'github', slug },
        },
      });

    expect(withRepository('gnghkim/DeployHub').spec.repository?.slug).toBe(
      'gnghkim/DeployHub',
    );
    expect(() => withRepository('DeployHub')).toThrow();
  });

  it('only permits importance values from 1 through 5', () => {
    expect(() =>
      manifestSchema.parse({
        ...base,
        spec: { ...base.spec, importance: 6 },
      }),
    ).toThrow();
  });

  it('rejects unknown keys', () => {
    expect(() => manifestSchema.parse({ ...base, extra: true })).toThrow();
  });
});
