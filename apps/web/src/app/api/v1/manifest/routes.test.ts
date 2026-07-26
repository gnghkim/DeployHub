import { MANIFEST_VERSION } from '@deployhub/manifest';
import { describe, expect, it } from 'vitest';
import { GET as getPublicSchema } from '../../../schemas/deployhub-v1.json/route';
import { GET as getApiSchema } from './schema/route';
import { GET as getTemplate } from './template/route';
import { POST as validateManifest } from './validate/route';

const VALID_MANIFEST = `apiVersion: deployhub.io/v1
kind: Project
metadata:
  name: DeployHub
  slug: deployhub
spec:
  lifecycle: production
  components:
    - name: web
      type: frontend
`;

describe('manifest Schema API routes', () => {
  it('serves the public JSON Schema with caching metadata', async () => {
    const response = getPublicSchema();
    const schema = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=3600',
    );
    expect(response.headers.get('etag')).toBeTruthy();
    expect(response.headers.get('x-manifest-version')).toBe(MANIFEST_VERSION);
    expect(schema.properties.apiVersion.enum).toContain(MANIFEST_VERSION);
  });

  it('serves the same JSON Schema from the versioned API', async () => {
    const publicResponse = getPublicSchema();
    const apiResponse = getApiSchema();

    expect(apiResponse.status).toBe(200);
    expect(apiResponse.headers.get('x-manifest-version')).toBe(
      MANIFEST_VERSION,
    );
    expect(await apiResponse.json()).toEqual(await publicResponse.json());
  });

  it('serves a commented YAML template', async () => {
    const response = getTemplate();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/yaml');
    expect(response.headers.get('x-manifest-version')).toBe(MANIFEST_VERSION);
    expect(body).toContain('# yaml-language-server: $schema=');
    expect(body).toContain('apiVersion: deployhub.io/v1');
  });

  it('validates a valid YAML manifest', async () => {
    const response = await validateManifest(
      new Request('http://localhost/api/v1/manifest/validate', {
        method: 'POST',
        body: VALID_MANIFEST,
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-manifest-version')).toBe(MANIFEST_VERSION);
    expect(await response.json()).toMatchObject({ ok: true, warnings: [] });
  });

  it('returns validation errors for invalid YAML', async () => {
    const response = await validateManifest(
      new Request('http://localhost/api/v1/manifest/validate', {
        method: 'POST',
        body: `${VALID_MANIFEST}unknown: true\n`,
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('x-manifest-version')).toBe(MANIFEST_VERSION);
    expect(await response.json()).toMatchObject({ ok: false });
  });

  it('rejects request bodies larger than 256KB', async () => {
    const response = await validateManifest(
      new Request('http://localhost/api/v1/manifest/validate', {
        method: 'POST',
        body: 'x'.repeat(256 * 1024 + 1),
      }),
    );

    expect(response.status).toBe(413);
    expect(response.headers.get('x-manifest-version')).toBe(MANIFEST_VERSION);
  });

  it(
    'stops reading a chunked body as soon as it exceeds 256KB',
    async () => {
      let cancelled = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(256 * 1024));
          controller.enqueue(new Uint8Array(1));
        },
        cancel() {
          cancelled = true;
        },
      });
      const request = new Request(
        'http://localhost/api/v1/manifest/validate',
        {
          method: 'POST',
          body,
          duplex: 'half',
        } as RequestInit & { duplex: 'half' },
      );

      const response = await validateManifest(request);

      expect(response.status).toBe(413);
      expect(cancelled).toBe(true);
    },
    1_000,
  );
});
