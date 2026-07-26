import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const CACHE_TTL_MS = 60 * 60 * 1_000;

export const DEFAULT_SCHEMA_CACHE_PATH = join(
  homedir(),
  '.cache',
  'deployhub',
  'schema-v1.json',
);

export type ManifestSchemaCache = {
  version: string;
  schema: Record<string, unknown>;
  fetchedAt: string;
  etag?: string;
};

export type ManifestSchemaResult = {
  schema: Record<string, unknown>;
  version: string;
  source: 'server' | 'cache';
};

export type SchemaClientOptions = {
  baseUrl: string;
  cachePath?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  warn?: (message: string) => void;
};

async function readCache(
  cachePath: string,
): Promise<ManifestSchemaCache | undefined> {
  try {
    const parsed = JSON.parse(
      await readFile(cachePath, 'utf8'),
    ) as Partial<ManifestSchemaCache>;
    if (
      typeof parsed.version !== 'string' ||
      typeof parsed.fetchedAt !== 'string' ||
      parsed.schema === null ||
      typeof parsed.schema !== 'object' ||
      Array.isArray(parsed.schema)
    ) {
      return undefined;
    }
    return parsed as ManifestSchemaCache;
  } catch {
    return undefined;
  }
}

function schemaUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/api/v1/manifest/schema`;
}

function responseVersion(response: Response): string {
  const version = response.headers.get('X-Manifest-Version');
  if (!version) {
    throw new Error(
      'DeployHub schema response is missing X-Manifest-Version',
    );
  }
  return version;
}

async function fetchSchema(
  url: string,
  fetchImpl: typeof fetch,
  cachePath: string,
  now: () => number,
): Promise<ManifestSchemaResult> {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Accept: 'application/schema+json, application/json' },
  });
  if (!response.ok) {
    throw new Error(
      `DeployHub schema server returned HTTP ${response.status}`,
    );
  }

  const version = responseVersion(response);
  const schema = (await response.json()) as Record<string, unknown>;
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error('DeployHub schema server returned an invalid JSON schema');
  }

  const cache: ManifestSchemaCache = {
    version,
    schema,
    fetchedAt: new Date(now()).toISOString(),
    ...(response.headers.get('ETag')
      ? { etag: response.headers.get('ETag') ?? undefined }
      : {}),
  };
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(cache, null, 2));
  return { schema, version, source: 'server' };
}

function unavailableError(cause: unknown): Error {
  const detail = cause instanceof Error ? `: ${cause.message}` : '';
  return new Error(
    `Unable to fetch the DeployHub manifest schema and no cache is available${detail}`,
    { cause },
  );
}

export async function getManifestSchema(
  options: SchemaClientOptions,
): Promise<ManifestSchemaResult> {
  const cachePath = options.cachePath ?? DEFAULT_SCHEMA_CACHE_PATH;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const warn = options.warn ?? console.warn;
  const url = schemaUrl(options.baseUrl);
  const cache = await readCache(cachePath);
  const cacheAge = cache
    ? now() - Date.parse(cache.fetchedAt)
    : Number.POSITIVE_INFINITY;
  let fallbackCache = cache;

  try {
    if (cache && cacheAge <= CACHE_TTL_MS) {
      const versionResponse = await fetchImpl(url, { method: 'HEAD' });
      if (!versionResponse.ok) {
        throw new Error(
          `DeployHub schema server returned HTTP ${versionResponse.status}`,
        );
      }
      const serverVersion = responseVersion(versionResponse);
      if (serverVersion === cache.version) {
        return {
          schema: cache.schema,
          version: cache.version,
          source: 'cache',
        };
      }

      fallbackCache = undefined;
      await rm(cachePath, { force: true });
    }

    return await fetchSchema(url, fetchImpl, cachePath, now);
  } catch (error) {
    if (fallbackCache) {
      warn(
        `DeployHub is offline; using cached schema ${fallbackCache.version} from ${fallbackCache.fetchedAt}.`,
      );
      return {
        schema: fallbackCache.schema,
        version: fallbackCache.version,
        source: 'cache',
      };
    }
    throw unavailableError(error);
  }
}
