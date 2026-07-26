import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getManifestSchema,
  type ManifestSchemaCache,
} from './schema-client';

const NOW = Date.parse('2026-07-26T12:00:00.000Z');
const schemaV1 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'DeployHub manifest v1',
  type: 'object',
};
const schemaV2 = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'DeployHub manifest v2',
  type: 'object',
};
const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function temporaryCachePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'deployhub-schema-'));
  temporaryDirectories.push(directory);
  return join(directory, 'nested', 'schema-v1.json');
}

async function seedCache(
  cachePath: string,
  overrides: Partial<ManifestSchemaCache> = {},
): Promise<void> {
  const cache: ManifestSchemaCache = {
    version: 'deployhub.io/v1',
    schema: schemaV1,
    fetchedAt: new Date(NOW - 1_000).toISOString(),
    etag: '"schema-v1"',
    ...overrides,
  };
  await mkdir(join(cachePath, '..'), { recursive: true });
  await writeFile(cachePath, JSON.stringify(cache));
}

describe('getManifestSchema', () => {
  it('fetches the server schema and caches it', async () => {
    const cachePath = await temporaryCachePath();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(schemaV1), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          ETag: '"schema-v1"',
          'X-Manifest-Version': 'deployhub.io/v1',
        },
      }),
    );

    const result = await getManifestSchema({
      baseUrl: 'https://hub.example',
      cachePath,
      fetchImpl,
      now: () => NOW,
    });

    expect(result).toEqual({
      schema: schemaV1,
      version: 'deployhub.io/v1',
      source: 'server',
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hub.example/api/v1/manifest/schema',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(JSON.parse(await readFile(cachePath, 'utf8'))).toEqual({
      version: 'deployhub.io/v1',
      schema: schemaV1,
      fetchedAt: new Date(NOW).toISOString(),
      etag: '"schema-v1"',
    });
  });

  it('uses a fresh cache after confirming the server version', async () => {
    const cachePath = await temporaryCachePath();
    await seedCache(cachePath);
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { 'X-Manifest-Version': 'deployhub.io/v1' },
      }),
    );

    const result = await getManifestSchema({
      baseUrl: 'https://hub.example/',
      cachePath,
      fetchImpl,
      now: () => NOW,
    });

    expect(result).toEqual({
      schema: schemaV1,
      version: 'deployhub.io/v1',
      source: 'cache',
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hub.example/api/v1/manifest/schema',
      expect.objectContaining({ method: 'HEAD' }),
    );
  });

  it('warns before using a cache while offline', async () => {
    const cachePath = await temporaryCachePath();
    await seedCache(cachePath);
    const warning = vi.fn();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('network unavailable'));

    const result = await getManifestSchema({
      baseUrl: 'https://hub.example',
      cachePath,
      fetchImpl,
      now: () => NOW,
      warn: warning,
    });

    expect(result.source).toBe('cache');
    expect(warning).toHaveBeenCalledOnce();
    expect(warning.mock.calls[0]?.[0]).toMatch(/offline.*cached schema/i);
  });

  it('fails clearly when both server and cache are unavailable', async () => {
    const cachePath = await temporaryCachePath();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('network unavailable'));

    await expect(
      getManifestSchema({
        baseUrl: 'https://hub.example',
        cachePath,
        fetchImpl,
        now: () => NOW,
      }),
    ).rejects.toThrow(
      'Unable to fetch the DeployHub manifest schema and no cache is available',
    );
  });

  it('discards a cache and refetches when the manifest version differs', async () => {
    const cachePath = await temporaryCachePath();
    await seedCache(cachePath);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { 'X-Manifest-Version': 'deployhub.io/v2' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(schemaV2), {
          status: 200,
          headers: {
            ETag: '"schema-v2"',
            'X-Manifest-Version': 'deployhub.io/v2',
          },
        }),
      );

    const result = await getManifestSchema({
      baseUrl: 'https://hub.example',
      cachePath,
      fetchImpl,
      now: () => NOW,
    });

    expect(result).toEqual({
      schema: schemaV2,
      version: 'deployhub.io/v2',
      source: 'server',
    });
    expect(fetchImpl.mock.calls.map(([, init]) => init?.method)).toEqual([
      'HEAD',
      'GET',
    ]);
    expect(JSON.parse(await readFile(cachePath, 'utf8')).version).toBe(
      'deployhub.io/v2',
    );
  });
});
