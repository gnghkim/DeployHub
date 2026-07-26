import type { ParseResult } from '@deployhub/manifest';

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
