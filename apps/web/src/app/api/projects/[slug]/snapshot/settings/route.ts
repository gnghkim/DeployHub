import type { Db } from '@deployhub/db';
import { auth } from '../../../../../../auth/config';
import { db } from '../../../../../../lib/db';
import { readBoundedBody } from '../bounded-body';
import {
  authorizeSnapshotProject,
  notFoundResponse,
  revalidateSnapshotProject,
  snapshotRouteDependencies,
  type SnapshotRouteContext,
  type SnapshotRouteDependencies,
  type SnapshotSettings,
} from '../route-utils';

export { persistSnapshotSettings } from '../route-utils';

const MAX_SETTINGS_BODY_BYTES = 16 * 1024;
const BODY_READ_TIMEOUT_MS = 10_000;

function normalizePublicHttpUrl(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    return undefined;
  }
  if (value.length > 2_048) return undefined;
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
      || parsed.hostname.length === 0
      || parsed.username.length > 0
      || parsed.password.length > 0
      || parsed.port.length > 0
      || parsed.hash.length > 0
    ) {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function parseSettings(value: unknown): SnapshotSettings | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => key !== 'mode' && key !== 'url')
    || (record.mode !== 'disabled' && record.mode !== 'automatic')
  ) {
    return undefined;
  }
  const url = record.url === undefined && record.mode === 'disabled'
    ? null
    : normalizePublicHttpUrl(record.url);
  if (url === undefined || (record.mode === 'automatic' && url === null)) {
    return undefined;
  }
  return { mode: record.mode, url };
}

export function createSnapshotSettingsHandler(
  database: Db,
  overrides: Partial<SnapshotRouteDependencies> = { auth: () => auth() },
) {
  const dependencies = snapshotRouteDependencies(overrides);
  return async function POST(
    request: Request,
    context: SnapshotRouteContext,
  ): Promise<Response> {
    const authorized = await authorizeSnapshotProject(database, context, dependencies);
    if (!authorized.ok) return authorized.response;

    const mediaType = request.headers.get('content-type')
      ?.split(';', 1)[0]
      ?.trim()
      .toLowerCase();
    if (mediaType !== 'application/json') {
      return Response.json({ error: 'JSON content type required' }, { status: 415 });
    }

    const boundedBody = await readBoundedBody(request.body, {
      maximumBytes: MAX_SETTINGS_BODY_BYTES,
      timeoutMs: BODY_READ_TIMEOUT_MS,
      declaredLength: request.headers.get('content-length'),
      signal: request.signal,
    });
    if (!boundedBody.ok) {
      if (boundedBody.reason === 'too_large') {
        return Response.json({ error: 'Request body too large' }, { status: 413 });
      }
      if (boundedBody.reason === 'timeout' || boundedBody.reason === 'aborted') {
        return Response.json({ error: 'Request body timeout' }, { status: 408 });
      }
      return Response.json({ error: 'Invalid settings' }, { status: 400 });
    }

    let body: unknown;
    try {
      const json = new TextDecoder('utf-8', { fatal: true }).decode(boundedBody.body);
      body = JSON.parse(json) as unknown;
    } catch {
      return Response.json({ error: 'Invalid settings' }, { status: 400 });
    }
    const settings = parseSettings(body);
    if (!settings) {
      return Response.json({ error: 'Invalid settings' }, { status: 400 });
    }
    const updated = await dependencies.updateSettings(
      database,
      authorized.project,
      settings,
      dependencies.randomUUID(),
    );
    if (!updated) return notFoundResponse();

    revalidateSnapshotProject(dependencies, authorized.project.slug);
    return Response.json({ ok: true });
  };
}

export const POST = createSnapshotSettingsHandler(db);
