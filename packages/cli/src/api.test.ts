import { describe, expect, it, vi } from 'vitest';
import { validateRemoteManifest } from './api';

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
