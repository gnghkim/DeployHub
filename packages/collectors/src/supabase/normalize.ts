import type { ExternalResource } from '../types';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return typeof value === 'object'
      && value !== null
      && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function normalizeSupabaseProject(value: unknown): ExternalResource {
  const project = record(value);
  if (
    typeof project.ref !== 'string'
    || typeof project.name !== 'string'
  ) {
    throw new Error('Supabase 프로젝트 응답의 필수 필드가 없습니다.');
  }

  const database = record(project.database);
  const region = optionalString(project.region);
  const status = optionalString(project.status);
  return {
    provider: 'supabase',
    externalId: project.ref,
    resourceType: 'supabase_project',
    name: project.name,
    ...(status === undefined ? {} : { status }),
    ...(region === undefined ? {} : { region }),
    metadata: {
      organizationId: optionalString(project.organization_id) ?? null,
      databaseHost: optionalString(database.host) ?? null,
      databaseVersion: optionalString(database.version) ?? null,
      postgresEngine: optionalString(database.postgres_engine) ?? null,
    },
    observedAt: new Date().toISOString(),
  };
}
