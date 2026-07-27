import type {
  ExternalDeployment,
  ExternalResource,
} from '../types';

type UnknownRecord = Record<string, unknown>;

export type VercelEnvironmentVariable = {
  key: string;
  target: string[];
  type: string;
};

function asRecord(value: unknown, message: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as UnknownRecord;
}

function toIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const numeric = typeof value === 'string' ? Number(value) : value;
  const timestamp = Number.isFinite(numeric)
    ? new Date(Math.abs(numeric) < 1_000_000_000_000 ? numeric * 1_000 : numeric)
    : new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function productionDomain(project: UnknownRecord): string | null {
  const targets = project.targets;
  if (typeof targets !== 'object' || targets === null) return null;
  const production = (targets as UnknownRecord).production;
  if (typeof production !== 'object' || production === null) return null;
  const aliases = (production as UnknownRecord).alias;
  if (!Array.isArray(aliases)) return null;
  return aliases.find((alias): alias is string => typeof alias === 'string')
    ?? null;
}

function gitRepository(project: UnknownRecord): string | null {
  const link = project.link;
  if (typeof link !== 'object' || link === null) return null;
  const { org, repo } = link as UnknownRecord;
  if (typeof repo !== 'string') return null;
  if (repo.includes('/')) return repo;
  return typeof org === 'string' && org !== '' ? `${org}/${repo}` : repo;
}

function normalizeEnvironmentVariable(
  value: VercelEnvironmentVariable,
): VercelEnvironmentVariable {
  const record = asRecord(
    value,
    'Vercel 환경 변수 응답 형식이 올바르지 않습니다.',
  );
  if (
    typeof record.key !== 'string'
    || typeof record.type !== 'string'
    || !Array.isArray(record.target)
    || record.target.some((target) => typeof target !== 'string')
  ) {
    throw new Error('Vercel 환경 변수 응답의 필수 필드가 없습니다.');
  }
  return {
    key: record.key,
    target: [...record.target as string[]].sort(),
    type: record.type,
  };
}

export function normalizeVercelProject(
  projectValue: unknown,
  envVars: VercelEnvironmentVariable[],
): ExternalResource {
  const project = asRecord(
    projectValue,
    'Vercel 프로젝트 응답 형식이 올바르지 않습니다.',
  );
  if (
    typeof project.id !== 'string'
    || typeof project.name !== 'string'
  ) {
    throw new Error('Vercel 프로젝트 응답의 필수 필드가 없습니다.');
  }

  const createdAt = toIsoTimestamp(project.createdAt);
  const updatedAt = toIsoTimestamp(project.updatedAt);
  const domain = productionDomain(project);
  const metadata = {
    framework: typeof project.framework === 'string'
      ? project.framework
      : null,
    gitRepository: gitRepository(project),
    productionDomain: domain,
    nodeVersion: typeof project.nodeVersion === 'string'
      ? project.nodeVersion
      : null,
    envVars: envVars.map(normalizeEnvironmentVariable),
    createdAt,
    updatedAt,
  };

  return {
    provider: 'vercel',
    externalId: project.id,
    resourceType: 'vercel_project',
    name: project.name,
    status: 'active',
    ...(domain === null ? {} : { url: `https://${domain}` }),
    metadata,
    observedAt: updatedAt ?? createdAt ?? new Date().toISOString(),
  };
}

export function normalizeVercelDeployment(
  deploymentValue: unknown,
): ExternalDeployment {
  const deployment = asRecord(
    deploymentValue,
    'Vercel 배포 응답 형식이 올바르지 않습니다.',
  );
  const state = deployment.state ?? deployment.readyState;
  if (
    typeof deployment.uid !== 'string'
    || typeof deployment.projectId !== 'string'
    || typeof state !== 'string'
  ) {
    throw new Error('Vercel 배포 응답의 필수 필드가 없습니다.');
  }

  const meta = typeof deployment.meta === 'object' && deployment.meta !== null
    ? deployment.meta as UnknownRecord
    : {};
  const target = typeof deployment.target === 'string'
    ? deployment.target
    : 'preview';
  const deploymentUrl = typeof deployment.url === 'string'
    ? deployment.url
    : null;
  const startedAt = toIsoTimestamp(
    deployment.buildingAt ?? deployment.createdAt ?? deployment.created,
  );
  const completedAt = toIsoTimestamp(
    deployment.ready ?? deployment.readyAt,
  );

  return {
    resourceExternalId: deployment.projectId,
    externalDeploymentId: deployment.uid,
    environment: target,
    status: state,
    ...(typeof meta.githubCommitSha === 'string'
      ? { commitSha: meta.githubCommitSha }
      : {}),
    ...(deploymentUrl === null
      ? {}
      : {
          deploymentUrl: /^https?:\/\//i.test(deploymentUrl)
            ? deploymentUrl
            : `https://${deploymentUrl}`,
        }),
    ...(startedAt === null ? {} : { startedAt }),
    ...(completedAt === null ? {} : { completedAt }),
    metadata: {},
  };
}
