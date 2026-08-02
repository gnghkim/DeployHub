import type { Db } from '@deployhub/db';
import { auth } from '../../../../../../auth/config';
import { db } from '../../../../../../lib/db';
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

    let body: unknown;
    try {
      body = await request.json();
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
