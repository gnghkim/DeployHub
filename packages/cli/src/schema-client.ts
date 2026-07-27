import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { MANIFEST_VERSION } from '@deployhub/manifest';

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

class UnsupportedManifestVersionError extends Error {}

function compatibleResponseVersion(response: Response): string {
  const version = responseVersion(response);
  if (version !== MANIFEST_VERSION) {
    throw new UnsupportedManifestVersionError(
      `Unsupported DeployHub manifest version ${version}; expected ${MANIFEST_VERSION}`,
    );
  }
  return version;
}

async function fetchSchema(
  url: string,
  fetchImpl: typeof fetch,
  cachePath: string,
  now: () => number,
  cache?: ManifestSchemaCache,
): Promise<ManifestSchemaResult> {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Accept: 'application/schema+json, application/json',
      ...(cache?.etag ? { 'If-None-Match': cache.etag } : {}),
    },
  });
  const version = compatibleResponseVersion(response);
  if (response.status === 304) {
    if (!cache) {
      throw new Error(
        'DeployHub schema server returned 304 without a cached schema',
      );
    }
    return {
      schema: cache.schema,
      version,
      source: 'cache',
    };
  }
  if (!response.ok) {
    throw new Error(
      `DeployHub schema server returned HTTP ${response.status}`,
    );
  }

  const schema = (await response.json()) as Record<string, unknown>;
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error('DeployHub schema server returned an invalid JSON schema');
  }
  const etag = response.headers.get('ETag');
  if (!etag) {
    throw new Error('DeployHub schema response is missing ETag');
  }

  const nextCache: ManifestSchemaCache = {
    version,
    schema,
    fetchedAt: new Date(now()).toISOString(),
    etag,
  };
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(nextCache, null, 2));
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
  const compatibleCache = cache?.version === MANIFEST_VERSION
    ? cache
    : undefined;
  if (cache && !compatibleCache) {
    await rm(cachePath, { force: true });
  }
  const cacheAge = compatibleCache
    ? now() - Date.parse(compatibleCache.fetchedAt)
    : Number.POSITIVE_INFINITY;
  const fallbackCache =
    compatibleCache && cacheAge <= CACHE_TTL_MS
      ? compatibleCache
      : undefined;

  try {
    return await fetchSchema(
      url,
      fetchImpl,
      cachePath,
      now,
      compatibleCache,
    );
  } catch (error) {
    if (error instanceof UnsupportedManifestVersionError) {
      await rm(cachePath, { force: true });
      throw error;
    }
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
