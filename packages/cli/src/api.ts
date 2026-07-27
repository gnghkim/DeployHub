import type {
  CurrentProject,
  ManifestDiff,
  ParseResult,
} from '@deployhub/manifest';

export type RemoteValidationOptions = {
  baseUrl: string;
  yamlText: string;
  fetchImpl?: typeof fetch;
};

function isValidationIssue(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const issue = value as Record<string, unknown>;
  return (
    typeof issue.path === 'string' &&
    typeof issue.message === 'string' &&
    (issue.severity === 'error' || issue.severity === 'warning')
  );
}

function isParseResult(value: unknown): value is ParseResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const result = value as Record<string, unknown>;
  if (result.ok === false) {
    return (
      Array.isArray(result.errors) &&
      result.errors.every(isValidationIssue)
    );
  }
  return (
    result.ok === true &&
    result.manifest !== null &&
    typeof result.manifest === 'object' &&
    !Array.isArray(result.manifest) &&
    Array.isArray(result.warnings) &&
    result.warnings.every(isValidationIssue)
  );
}

export async function validateRemoteManifest({
  baseUrl,
  yamlText,
  fetchImpl = globalThis.fetch,
}: RemoteValidationOptions): Promise<ParseResult> {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/v1/manifest/validate`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'text/yaml; charset=utf-8',
    },
    body: yamlText,
  });
  if (!response.ok) {
    throw new Error(
      `Remote manifest validation failed with HTTP ${response.status}`,
    );
  }
  const result: unknown = await response.json();
  if (!isParseResult(result)) {
    throw new Error(
      'Remote manifest validation returned an invalid response',
    );
  }
  return result;
}

export type DraftSubmissionResult = {
  id: string;
  status: string;
  url: string;
};

export type SubmitProjectDraftOptions = {
  baseUrl: string;
  token: string;
  manifestYaml: string;
  fieldSources: Record<string, unknown>;
  diff?: ManifestDiff;
  fetchImpl?: typeof fetch;
};

function baseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function isDraftSubmissionResult(
  value: unknown,
): value is DraftSubmissionResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const result = value as Record<string, unknown>;
  return (
    typeof result.id === 'string'
    && typeof result.status === 'string'
    && typeof result.url === 'string'
  );
}

export async function submitProjectDraft({
  baseUrl: serverUrl,
  token,
  manifestYaml,
  fieldSources,
  diff,
  fetchImpl = globalThis.fetch,
}: SubmitProjectDraftOptions): Promise<DraftSubmissionResult> {
  let response: Response;
  try {
    response = await fetchImpl(
      `${baseUrl(serverUrl)}/api/v1/project-drafts`,
      {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          manifestYaml,
          fieldSources,
          ...(diff ? { diff } : {}),
        }),
      },
    );
  } catch {
    throw new Error(
      'Unable to reach the DeployHub Draft submission endpoint',
    );
  }
  if (!response.ok) {
    throw new Error(
      `DeployHub Draft submission failed with HTTP ${response.status}`,
    );
  }
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error(
      'DeployHub Draft submission returned an invalid response',
    );
  }
  if (!isDraftSubmissionResult(result)) {
    throw new Error('DeployHub Draft submission returned an invalid response');
  }
  return result;
}

export type CurrentProjectOptions = {
  baseUrl: string;
  slug: string;
  token: string;
  fetchImpl?: typeof fetch;
};

export class ProjectNotFoundError extends Error {
  constructor(slug: string) {
    super(`DeployHub project "${slug}" is not registered`);
    this.name = 'ProjectNotFoundError';
  }
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isCurrentProject(value: unknown): value is CurrentProject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const project = value as Record<string, unknown>;
  return (
    typeof project.name === 'string'
    && typeof project.slug === 'string'
    && isNullableString(project.description)
    && typeof project.lifecycle === 'string'
    && typeof project.importance === 'number'
    && isNullableString(project.owner)
    && isNullableString(project.repository)
    && Array.isArray(project.components)
    && project.components.every((component) => {
      if (
        component === null
        || typeof component !== 'object'
        || Array.isArray(component)
      ) {
        return false;
      }
      const item = component as Record<string, unknown>;
      return (
        typeof item.name === 'string'
        && typeof item.componentType === 'string'
        && isNullableString(item.framework)
        && isNullableString(item.runtime)
        && isNullableString(item.language)
        && typeof item.criticality === 'number'
        && (
          item.provider === undefined
          || isNullableString(item.provider)
        )
        && (
          item.externalRef === undefined
          || isNullableString(item.externalRef)
        )
        && (
          item.containerName === undefined
          || isNullableString(item.containerName)
        )
        && (
          item.url === undefined
          || isNullableString(item.url)
        )
      );
    })
    && (
      project.domains === undefined
      || (
        Array.isArray(project.domains)
        && project.domains.every((domain) => {
          if (
            domain === null
            || typeof domain !== 'object'
            || Array.isArray(domain)
          ) {
            return false;
          }
          const item = domain as Record<string, unknown>;
          return (
            typeof item.domain === 'string'
            && typeof item.environment === 'string'
          );
        })
      )
    )
  );
}

export async function getCurrentProject({
  baseUrl: serverUrl,
  slug,
  token,
  fetchImpl = globalThis.fetch,
}: CurrentProjectOptions): Promise<CurrentProject> {
  let response: Response;
  try {
    response = await fetchImpl(
      `${baseUrl(serverUrl)}/api/v1/projects/${encodeURIComponent(slug)}/manifest`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      },
    );
  } catch {
    throw new Error('Unable to reach the DeployHub project lookup endpoint');
  }
  if (response.status === 404) throw new ProjectNotFoundError(slug);
  if (!response.ok) {
    throw new Error(
      `DeployHub project lookup failed with HTTP ${response.status}`,
    );
  }
  const result: unknown = await response.json();
  const project =
    result !== null && typeof result === 'object' && !Array.isArray(result)
      ? (result as Record<string, unknown>).project
      : undefined;
  if (!isCurrentProject(project)) {
    throw new Error('DeployHub project lookup returned an invalid response');
  }
  return project;
}

export type ProjectStatus = {
  registered: boolean;
  slug: string;
  name: string | null;
  status: 'active' | 'paused' | 'maintenance' | 'archived' | null;
  lifecycle:
    | 'experimental'
    | 'development'
    | 'production'
    | 'deprecated'
    | null;
  componentCount: number;
  linkedResourceCount: number;
  latestDraft: {
    id: string;
    status:
      | 'draft'
      | 'validation_failed'
      | 'pending_review'
      | 'approved'
      | 'rejected'
      | 'superseded';
    createdAt: string;
  } | null;
  projectUrl: string | null;
};

const PROJECT_STATUSES = new Set([
  'active',
  'paused',
  'maintenance',
  'archived',
]);
const PROJECT_LIFECYCLES = new Set([
  'experimental',
  'development',
  'production',
  'deprecated',
]);
const DRAFT_STATUSES = new Set([
  'draft',
  'validation_failed',
  'pending_review',
  'approved',
  'rejected',
  'superseded',
]);

function isNullableMember(value: unknown, allowed: Set<string>): boolean {
  return value === null || (
    typeof value === 'string'
    && allowed.has(value)
  );
}

function isLatestDraft(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const draft = value as Record<string, unknown>;
  return (
    typeof draft.id === 'string'
    && typeof draft.status === 'string'
    && DRAFT_STATUSES.has(draft.status)
    && typeof draft.createdAt === 'string'
  );
}

function isProjectStatus(value: unknown): value is ProjectStatus {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const status = value as Record<string, unknown>;
  return (
    typeof status.registered === 'boolean'
    && typeof status.slug === 'string'
    && isNullableString(status.name)
    && isNullableMember(status.status, PROJECT_STATUSES)
    && isNullableMember(status.lifecycle, PROJECT_LIFECYCLES)
    && Number.isInteger(status.componentCount)
    && Number(status.componentCount) >= 0
    && Number.isInteger(status.linkedResourceCount)
    && Number(status.linkedResourceCount) >= 0
    && isLatestDraft(status.latestDraft)
    && isNullableString(status.projectUrl)
  );
}

export async function getProjectStatus({
  baseUrl: serverUrl,
  slug,
  token,
  fetchImpl = globalThis.fetch,
}: CurrentProjectOptions): Promise<ProjectStatus> {
  let response: Response;
  try {
    response = await fetchImpl(
      `${baseUrl(serverUrl)}/api/v1/projects/${encodeURIComponent(slug)}/status`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      },
    );
  } catch {
    throw new Error('Unable to reach the DeployHub project status endpoint');
  }
  if (response.status === 404) throw new ProjectNotFoundError(slug);
  if (!response.ok) {
    throw new Error(
      `DeployHub project status failed with HTTP ${response.status}`,
    );
  }
  const result: unknown = await response.json();
  if (!isProjectStatus(result)) {
    throw new Error('DeployHub project status returned an invalid response');
  }
  return result;
}
