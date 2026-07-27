import type {
  ExternalDeployment,
  ExternalResource,
} from '../types';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return typeof value === 'object'
      && value !== null
      && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function requiredString(
  record: UnknownRecord,
  key: string,
): string {
  const value = record[key];
  if (typeof value !== 'string' || value === '') {
    throw new Error('Docker inspect 응답의 필수 필드가 없습니다.');
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function stringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string',
    ),
  );
}

function environmentKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== 'string') return [];
    const equals = entry.indexOf('=');
    return [equals === -1 ? entry : entry.slice(0, equals)];
  });
}

function normalizedMounts(
  value: unknown,
): Array<{
  type: string | null;
  name: string | null;
  destination: string | null;
}> {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const mount = asRecord(entry);
    return {
      type: optionalString(mount.Type),
      name: optionalString(mount.Name),
      destination: optionalString(mount.Destination),
    };
  });
}

function inspectParts(value: unknown): {
  inspect: UnknownRecord;
  config: UnknownRecord;
  state: UnknownRecord;
  labels: Record<string, string>;
  id: string;
} {
  const inspect = asRecord(value);
  const id = requiredString(inspect, 'Id');
  const config = asRecord(inspect.Config);
  const state = asRecord(inspect.State);
  return {
    inspect,
    config,
    state,
    labels: stringRecord(config.Labels),
    id,
  };
}

export function normalizeDockerContainer(
  value: unknown,
): ExternalResource {
  const { inspect, config, state, labels, id } = inspectParts(value);
  const health = asRecord(state.Health);
  const networks = asRecord(asRecord(inspect.NetworkSettings).Networks);
  const restartCount = typeof inspect.RestartCount === 'number'
    ? inspect.RestartCount
    : 0;

  const metadata = {
    image: optionalString(config.Image),
    imageId: optionalString(inspect.Image),
    health: optionalString(health.Status),
    createdAt: isoTimestamp(inspect.Created),
    startedAt: isoTimestamp(state.StartedAt),
    restartCount,
    labels,
    composeProject: labels['com.docker.compose.project'] ?? null,
    composeService: labels['com.docker.compose.service'] ?? null,
    networks: Object.keys(networks),
    envKeys: environmentKeys(config.Env),
    mounts: normalizedMounts(inspect.Mounts),
  };

  return {
    provider: 'docker',
    externalId: id,
    resourceType: 'docker_container',
    name: requiredString(inspect, 'Name').replace(/^\/+/, ''),
    status: optionalString(state.Status) ?? 'unknown',
    metadata,
    observedAt: new Date().toISOString(),
  };
}

export function normalizeDockerDeployment(
  value: unknown,
): ExternalDeployment {
  const { config, state, labels, id } = inspectParts(value);
  const startedAt = isoTimestamp(state.StartedAt);

  return {
    resourceExternalId: id,
    externalDeploymentId: id,
    environment: labels['deployhub.environment'] ?? 'unknown',
    status: optionalString(state.Status) ?? 'unknown',
    ...(typeof config.Image === 'string'
      ? { imageName: config.Image }
      : {}),
    ...(startedAt === null ? {} : { startedAt }),
    metadata: {},
  };
}
