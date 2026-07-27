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

// 라벨은 값이 무엇이든 들어올 수 있는 자유 문자열이라 통째로 담으면
// 안 된다. compose 가 붙이는 것만 봐도 호스트 경로가 셋 있다. 운영에서
// 실측한 값이다.
//
//   com.docker.compose.project.config_files    /home/dev/workwiki/docker-compose.yml
//   com.docker.compose.project.working_dir     /home/dev/workwiki
//   com.docker.compose.project.environment_file
//
// 마지막 것은 남의 프로젝트 .env 파일 위치다. Mounts[].Source 를 막아
// 놓고 이쪽을 열어 두면 같은 것이 다른 문으로 들어온다.
//
// 차단목록으로 저 셋만 지우면 compose 가 경로 라벨을 하나 더 만드는
// 날 다시 샌다. 허용목록으로 간다.
const LABEL_PREFIXES = ['deployhub.', 'org.opencontainers.image.'];

function allowedLabels(
  labels: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(labels).filter(([key]) =>
      LABEL_PREFIXES.some((prefix) => key.startsWith(prefix))
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
    // compose 식별자는 아래 전용 필드로 따로 뽑으므로, labels 에는
    // 우리가 붙인 것과 이미지 표준 메타데이터만 남긴다.
    labels: allowedLabels(labels),
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
