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

describe('manifest component deployment declarations', () => {
  const parseComponent = (component: Record<string, unknown>) =>
    manifestSchema.parse({
      ...base,
      spec: {
        ...base.spec,
        components: [{ name: 'web', type: 'frontend', ...component }],
      },
    }).spec.components[0]!;

  it('rejects providers outside the supported 12-value catalog', () => {
    expect(() => parseComponent({ provider: 'mycloud' })).toThrow();
    expect(() => parseComponent({ provider: 'superbase' })).toThrow();

    for (const provider of [
      'vercel',
      'hostinger',
      'supabase',
      'docker',
      'github',
      'aws',
      'cloudflare',
      'upstash',
      'railway',
      'neon',
      'planetscale',
      'self-hosted',
    ]) {
      expect(() => parseComponent({ provider })).not.toThrow();
    }
  });

  it('keeps all four deployment declaration fields optional', () => {
    const component = parseComponent({});

    expect(component.provider).toBeUndefined();
    expect(component.externalRef).toBeUndefined();
    expect(component.container).toBeUndefined();
    expect(component.url).toBeUndefined();
  });

  it('trims every deployment declaration string', () => {
    expect(
      parseComponent({
        provider: '  docker  ',
        externalRef: '  deployhub-project  ',
        container: '  deployhub-web  ',
        url: '  https://hub.nolzza.net  ',
      }),
    ).toMatchObject({
      provider: 'docker',
      externalRef: 'deployhub-project',
      container: 'deployhub-web',
      url: 'https://hub.nolzza.net',
    });
  });

  it('normalizes an empty externalRef to undefined', () => {
    expect(parseComponent({ externalRef: '   ' }).externalRef).toBeUndefined();
  });

  it('requires a Docker-compatible container name', () => {
    expect(parseComponent({ container: 'deployhub-web.1' }).container).toBe(
      'deployhub-web.1',
    );
    expect(() => parseComponent({ container: '-deployhub-web' })).toThrow();
    expect(() => parseComponent({ container: 'deployhub/web' })).toThrow();
  });

  it('requires an http or https URL', () => {
    expect(parseComponent({ url: 'http://localhost:3000' }).url).toBe(
      'http://localhost:3000',
    );
    expect(parseComponent({ url: 'https://hub.nolzza.net' }).url).toBe(
      'https://hub.nolzza.net',
    );
    expect(() => parseComponent({ url: 'ftp://hub.nolzza.net' })).toThrow();
    expect(() => parseComponent({ url: 'hub.nolzza.net' })).toThrow();
  });

  it('continues to reject unknown component keys', () => {
    expect(() => parseComponent({ deploymentTarget: 'vps-1' })).toThrow();
  });
});
