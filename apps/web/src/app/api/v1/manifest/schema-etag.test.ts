import { describe, expect, it, vi } from 'vitest';

async function etagFor(schema: Record<string, unknown>): Promise<string | null> {
  vi.resetModules();
  vi.doMock('@deployhub/manifest', () => ({
    MANIFEST_VERSION: 'deployhub.io/v1',
    manifestJsonSchema: () => schema,
  }));
  const route = await import('../../../schemas/deployhub-v1.json/route');
  return route.GET().headers.get('etag');
}

describe('manifest Schema ETag', () => {
  it('is deterministic for identical schema content', async () => {
    const schema = { type: 'object', properties: { kind: { type: 'string' } } };

    expect(await etagFor(schema)).toBe(await etagFor({
      properties: { kind: { type: 'string' } },
      type: 'object',
    }));
  });

  it('changes when schema content changes', async () => {
    const original = await etagFor({
      type: 'object',
      properties: { kind: { type: 'string' } },
    });
    const changed = await etagFor({
      type: 'object',
      properties: {
        kind: { type: 'string' },
        provider: { type: 'string' },
      },
    });

    expect(changed).not.toBe(original);
  });
});
