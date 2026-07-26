import { parseDocument } from 'yaml';
import { manifestSchema, type Manifest } from './schema';

export type ValidationIssue = {
  path: string;
  message: string;
  severity: 'error' | 'warning';
};

export type ParseResult =
  | { ok: true; manifest: Manifest; warnings: ValidationIssue[] }
  | { ok: false; errors: ValidationIssue[] };

const formatPath = (path: PropertyKey[]): string =>
  path.reduce<string>((formatted, segment) => {
    if (typeof segment === 'number') {
      return `${formatted}[${segment}]`;
    }

    const name = String(segment);
    return formatted ? `${formatted}.${name}` : name;
  }, '');

const errorResult = (path: string, message: string): ParseResult => ({
  ok: false,
  errors: [{ path, message, severity: 'error' }],
});

export function parseManifest(yamlText: string): ParseResult {
  if (yamlText.trim().length === 0) {
    return errorResult('', 'Manifest YAML must not be empty');
  }

  try {
    const document = parseDocument(yamlText);
    if (document.errors.length > 0) {
      return {
        ok: false,
        errors: document.errors.map((error) => {
          const line = error.linePos?.[0]?.line;
          const location = line === undefined ? '' : ` at line ${line}`;
          return {
            path: '',
            message: `${error.message}${location}`,
            severity: 'error' as const,
          };
        }),
      };
    }

    const parsed = manifestSchema.safeParse(document.toJS());
    if (!parsed.success) {
      return {
        ok: false,
        errors: parsed.error.issues.map((issue) => ({
          path: formatPath(issue.path),
          message: issue.message,
          severity: 'error' as const,
        })),
      };
    }

    const warnings: ValidationIssue[] = [];
    if (parsed.data.spec.documents !== undefined) {
      warnings.push({
        path: 'spec.documents',
        message: 'Documents are validated but are not stored in M1c',
        severity: 'warning',
      });
    }

    return { ok: true, manifest: parsed.data, warnings };
  } catch (error) {
    return errorResult(
      '',
      error instanceof Error ? error.message : 'Unable to parse manifest YAML',
    );
  }
}
