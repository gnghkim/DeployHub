import { createHash } from 'node:crypto';
import {
  MANIFEST_VERSION,
  manifestJsonSchema,
} from '@deployhub/manifest';

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (
        left < right ? -1 : left > right ? 1 : 0
      ));
    return `{${entries.map(([key, child]) =>
      `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function matchesEtag(request: Request | undefined, etag: string): boolean {
  const header = request?.headers.get('if-none-match');
  if (!header) return false;
  return header
    .split(',')
    .map((candidate) => candidate.trim())
    .some((candidate) => candidate === '*' || candidate === etag);
}

export function manifestSchemaResponse(
  request?: Request,
  includeBody = true,
): Response {
  const body = stableJson(manifestJsonSchema());
  const etag = `"${createHash('sha256')
    .update(body)
    .digest('hex')
    .slice(0, 16)}"`;
  const headers = {
    'Cache-Control': 'public, max-age=3600',
    'Content-Type': 'application/schema+json; charset=utf-8',
    ETag: etag,
    'X-Manifest-Version': MANIFEST_VERSION,
  };

  if (matchesEtag(request, etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(includeBody ? body : null, { status: 200, headers });
}
