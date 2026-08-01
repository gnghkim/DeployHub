import { describe, expect, it, vi } from 'vitest';
import { getCurrentProject, validateRemoteManifest } from './api';

const currentProjectPayload = (
  componentOverrides: Record<string, unknown> = {},
) => ({
  project: {
    name: 'DeployHub',
    slug: 'deployhub',
    description: null,
    lifecycle: 'production',
    importance: 5,
    owner: null,
    repository: null,
    components: [
      {
        name: 'Web',
        componentType: 'frontend',
        framework: 'nextjs',
        runtime: 'node',
        language: 'typescript',
        criticality: 5,
        ...componentOverrides,
      },
    ],
  },
});

describe('validateRemoteManifest', () => {
  it('posts YAML to the public validation endpoint', async () => {
    const yamlText = 'apiVersion: deployhub.io/v1\nkind: Project\n';
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          ok: false,
          errors: [
            {
              path: 'metadata',
              message: 'Required',
              severity: 'error',
            },
          ],
        },
        {
          headers: { 'X-Manifest-Version': 'deployhub.io/v1' },
        },
      ),
    );

    const result = await validateRemoteManifest({
      baseUrl: 'https://hub.example/',
      yamlText,
      fetchImpl,
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          path: 'metadata',
          message: 'Required',
          severity: 'error',
        },
      ],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hub.example/api/v1/manifest/validate',
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'text/yaml; charset=utf-8',
        },
        body: yamlText,
      },
    );
  });

  it('fails clearly when the validation endpoint returns an HTTP error', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('unavailable', { status: 503 }));

    await expect(
      validateRemoteManifest({
        baseUrl: 'https://hub.example',
        yamlText: 'kind: Project\n',
        fetchImpl,
      }),
    ).rejects.toThrow('Remote manifest validation failed with HTTP 503');
  });

  it('rejects malformed successful responses with a protocol error', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ ok: 'yes' }));

    await expect(
      validateRemoteManifest({
        baseUrl: 'https://hub.example',
        yamlText: 'kind: Project\n',
        fetchImpl,
      }),
    ).rejects.toThrow(
      'Remote manifest validation returned an invalid response',
    );
  });
});

describe('getCurrentProject', () => {
  it.each([
    ['string', { healthUrl: 'https://hub.nolzza.net/api/health/ready' }],
    ['null', { healthUrl: null }],
    ['omitted', {}],
  ])('accepts a %s healthUrl', async (_label, componentOverrides) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(currentProjectPayload(componentOverrides)),
    );

    const project = await getCurrentProject({
      baseUrl: 'https://hub.example',
      slug: 'deployhub',
      token: 'test-token',
      fetchImpl,
    });

    expect(project.components[0]).toMatchObject(componentOverrides);
  });

  it('rejects a non-string healthUrl', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(currentProjectPayload({ healthUrl: 42 })),
    );

    await expect(getCurrentProject({
      baseUrl: 'https://hub.example',
      slug: 'deployhub',
      token: 'test-token',
      fetchImpl,
    })).rejects.toThrow(
      'DeployHub project lookup returned an invalid response',
    );
  });
});
