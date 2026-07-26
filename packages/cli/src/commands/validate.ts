import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ParseResult } from '@deployhub/manifest';
import { parseDocument } from 'yaml';
import { validateRemoteManifest } from '../api';
import {
  getManifestSchema,
  type ManifestSchemaResult,
} from '../schema-client';

type JsonSchema = boolean | Record<string, unknown>;

const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  '$anchor',
  '$comment',
  '$defs',
  '$id',
  '$ref',
  '$schema',
  'additionalProperties',
  'allOf',
  'anyOf',
  'const',
  'contains',
  'default',
  'dependentRequired',
  'deprecated',
  'description',
  'else',
  'enum',
  'examples',
  'format',
  'if',
  'items',
  'maxContains',
  'maximum',
  'maxItems',
  'maxLength',
  'minContains',
  'minimum',
  'minItems',
  'minLength',
  'not',
  'oneOf',
  'pattern',
  'patternProperties',
  'properties',
  'readOnly',
  'required',
  'then',
  'title',
  'type',
  'uniqueItems',
  'writeOnly',
]);

export type JsonSchemaIssue = {
  path: string;
  message: string;
};

export type ValidateOptions = {
  rootDir: string;
  baseUrl: string;
  remote: boolean;
  output?: (line: string) => void;
  cachePath?: string;
  fetchImpl?: typeof fetch;
  schemaLoader?: () => Promise<ManifestSchemaResult>;
  remoteValidator?: (yamlText: string) => Promise<ParseResult>;
};

function valueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function childPath(path: string, key: string | number): string {
  return typeof key === 'number'
    ? `${path}[${key}]`
    : path
      ? `${path}.${key}`
      : key;
}

function resolveReference(root: JsonSchema, reference: string): JsonSchema {
  if (!reference.startsWith('#/')) {
    throw new Error(`Unsupported JSON Schema reference: ${reference}`);
  }
  let current: unknown = root;
  for (const encodedSegment of reference.slice(2).split('/')) {
    const segment = encodedSegment
      .replaceAll('~1', '/')
      .replaceAll('~0', '~');
    if (
      current === null ||
      typeof current !== 'object' ||
      Array.isArray(current)
    ) {
      throw new Error(`Invalid JSON Schema reference: ${reference}`);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  if (
    typeof current !== 'boolean' &&
    (current === null || typeof current !== 'object' || Array.isArray(current))
  ) {
    throw new Error(`Invalid JSON Schema reference: ${reference}`);
  }
  return current as JsonSchema;
}

function assertSupportedSchema(schema: JsonSchema): void {
  if (typeof schema === 'boolean') return;
  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_SCHEMA_KEYWORDS.has(keyword)) {
      throw new Error(`Unsupported JSON Schema keyword: ${keyword}`);
    }
  }

  for (const keyword of [
    '$defs',
    'properties',
    'patternProperties',
  ] as const) {
    const children = schema[keyword];
    if (children && typeof children === 'object' && !Array.isArray(children)) {
      for (const child of Object.values(children)) {
        if (
          typeof child === 'boolean' ||
          (child !== null && typeof child === 'object' && !Array.isArray(child))
        ) {
          assertSupportedSchema(child as JsonSchema);
        }
      }
    }
  }
  for (const keyword of ['allOf', 'anyOf', 'oneOf'] as const) {
    const children = schema[keyword];
    if (Array.isArray(children)) {
      for (const child of children) {
        if (
          typeof child === 'boolean' ||
          (child !== null && typeof child === 'object' && !Array.isArray(child))
        ) {
          assertSupportedSchema(child as JsonSchema);
        }
      }
    }
  }
  for (const keyword of [
    'additionalProperties',
    'contains',
    'else',
    'if',
    'items',
    'not',
    'then',
  ] as const) {
    const child = schema[keyword];
    if (
      typeof child === 'boolean' ||
      (child !== null && typeof child === 'object' && !Array.isArray(child))
    ) {
      assertSupportedSchema(child as JsonSchema);
    }
  }
}

function isExpectedType(value: unknown, expected: string): boolean {
  if (expected === 'number') return typeof value === 'number';
  if (expected === 'integer') return Number.isInteger(value);
  if (expected === 'object') {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  if (expected === 'array') return Array.isArray(value);
  if (expected === 'null') return value === null;
  return typeof value === expected;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => jsonEqual(value, right[index]))
    );
  }
  if (
    left !== null &&
    right !== null &&
    typeof left === 'object' &&
    typeof right === 'object' &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    const leftObject = left as Record<string, unknown>;
    const rightObject = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftObject);
    const rightKeys = Object.keys(rightObject);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key) =>
          Object.hasOwn(rightObject, key) &&
          jsonEqual(leftObject[key], rightObject[key]),
      )
    );
  }
  return false;
}

function validateValue(
  value: unknown,
  schema: JsonSchema,
  root: JsonSchema,
  path: string,
  issues: JsonSchemaIssue[],
): void {
  if (schema === true) return;
  if (schema === false) {
    issues.push({ path, message: 'Value is forbidden by schema' });
    return;
  }

  if (typeof schema.$ref === 'string') {
    validateValue(value, resolveReference(root, schema.$ref), root, path, issues);
  }

  for (const child of (schema.allOf as JsonSchema[] | undefined) ?? []) {
    validateValue(value, child, root, path, issues);
  }

  const anyAlternatives = schema.anyOf as JsonSchema[] | undefined;
  if (anyAlternatives) {
    const matches = anyAlternatives.some((alternative) => {
      const alternativeIssues: JsonSchemaIssue[] = [];
      validateValue(value, alternative, root, path, alternativeIssues);
      return alternativeIssues.length === 0;
    });
    if (!matches) {
      issues.push({
        path,
        message: 'Value does not match any allowed schema',
      });
    }
  }

  const oneAlternatives = schema.oneOf as JsonSchema[] | undefined;
  if (oneAlternatives) {
    const matchCount = oneAlternatives.filter((alternative) => {
      const alternativeIssues: JsonSchemaIssue[] = [];
      validateValue(value, alternative, root, path, alternativeIssues);
      return alternativeIssues.length === 0;
    }).length;
    if (matchCount !== 1) {
      issues.push({
        path,
        message: `Expected exactly one matching schema, received ${matchCount}`,
      });
    }
  }

  if (
    typeof schema.not === 'boolean' ||
    (schema.not !== null &&
      typeof schema.not === 'object' &&
      !Array.isArray(schema.not))
  ) {
    const forbiddenIssues: JsonSchemaIssue[] = [];
    validateValue(
      value,
      schema.not as JsonSchema,
      root,
      path,
      forbiddenIssues,
    );
    if (forbiddenIssues.length === 0) {
      issues.push({ path, message: 'Value matches a forbidden schema' });
    }
  }

  if (
    typeof schema.if === 'boolean' ||
    (schema.if !== null &&
      typeof schema.if === 'object' &&
      !Array.isArray(schema.if))
  ) {
    const conditionIssues: JsonSchemaIssue[] = [];
    validateValue(
      value,
      schema.if as JsonSchema,
      root,
      path,
      conditionIssues,
    );
    const branch = conditionIssues.length === 0 ? schema.then : schema.else;
    if (
      typeof branch === 'boolean' ||
      (branch !== null &&
        typeof branch === 'object' &&
        !Array.isArray(branch))
    ) {
      validateValue(value, branch as JsonSchema, root, path, issues);
    }
  }

  const expectedTypes =
    typeof schema.type === 'string'
      ? [schema.type]
      : Array.isArray(schema.type)
        ? (schema.type as string[])
        : [];
  if (
    expectedTypes.length > 0 &&
    !expectedTypes.some((expected) => isExpectedType(value, expected))
  ) {
    issues.push({
      path,
      message: `Expected ${expectedTypes.join(' or ')}, received ${valueType(value)}`,
    });
    return;
  }

  if ('const' in schema && !jsonEqual(value, schema.const)) {
    issues.push({
      path,
      message: `Expected constant value ${JSON.stringify(schema.const)}`,
    });
  }
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((candidate) => jsonEqual(value, candidate))
  ) {
    issues.push({
      path,
      message: `Expected one of ${schema.enum.map(String).join(', ')}`,
    });
  }

  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    const objectValue = value as Record<string, unknown>;
    const properties = (schema.properties as
      | Record<string, JsonSchema>
      | undefined) ?? {};
    const patternProperties = (schema.patternProperties as
      | Record<string, JsonSchema>
      | undefined) ?? {};
    for (const [key, propertySchema] of Object.entries(properties)) {
      if (key in objectValue) {
        validateValue(
          objectValue[key],
          propertySchema,
          root,
          childPath(path, key),
          issues,
        );
      }
    }
    for (const required of (schema.required as string[] | undefined) ?? []) {
      if (!(required in objectValue)) {
        issues.push({
          path: childPath(path, required),
          message: 'Required field is missing',
        });
      }
    }
    for (const [trigger, dependencies] of Object.entries(
      (schema.dependentRequired as
        | Record<string, string[]>
        | undefined) ?? {},
    )) {
      if (!(trigger in objectValue)) continue;
      for (const dependency of dependencies) {
        if (!(dependency in objectValue)) {
          issues.push({
            path: childPath(path, dependency),
            message: `Field is required when ${trigger} is present`,
          });
        }
      }
    }
    for (const [key, child] of Object.entries(objectValue)) {
      const matchingPatterns = Object.entries(patternProperties).filter(
        ([pattern]) => new RegExp(pattern).test(key),
      );
      for (const [, patternSchema] of matchingPatterns) {
        validateValue(
          child,
          patternSchema,
          root,
          childPath(path, key),
          issues,
        );
      }
      if (key in properties || matchingPatterns.length > 0) {
        continue;
      }
      const additional = schema.additionalProperties;
      if (additional === false) {
        issues.push({
          path: childPath(path, key),
          message: 'Unknown field is not allowed',
        });
      } else if (
        additional !== null &&
        typeof additional === 'object' &&
        !Array.isArray(additional)
      ) {
        validateValue(
          child,
          additional as JsonSchema,
          root,
          childPath(path, key),
          issues,
        );
      }
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      issues.push({
        path,
        message: `Expected at least ${schema.minItems} items`,
      });
    }
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) {
      issues.push({
        path,
        message: `Expected at most ${schema.maxItems} items`,
      });
    }
    if (schema.uniqueItems === true) {
      const hasDuplicate = value.some((item, index) =>
        value.slice(0, index).some((earlier) => jsonEqual(item, earlier)),
      );
      if (hasDuplicate) {
        issues.push({ path, message: 'Array items must be unique' });
      }
    }
    if (
      schema.items !== null &&
      (typeof schema.items === 'boolean' ||
        (typeof schema.items === 'object' && !Array.isArray(schema.items)))
    ) {
      value.forEach((item, index) =>
        validateValue(
          item,
          schema.items as JsonSchema,
          root,
          childPath(path, index),
          issues,
        ),
      );
    }
    if (
      typeof schema.contains === 'boolean' ||
      (schema.contains !== null &&
        typeof schema.contains === 'object' &&
        !Array.isArray(schema.contains))
    ) {
      const matches = value.filter((item) => {
        const containsIssues: JsonSchemaIssue[] = [];
        validateValue(
          item,
          schema.contains as JsonSchema,
          root,
          path,
          containsIssues,
        );
        return containsIssues.length === 0;
      }).length;
      const minimum =
        typeof schema.minContains === 'number' ? schema.minContains : 1;
      const maximum =
        typeof schema.maxContains === 'number'
          ? schema.maxContains
          : Number.POSITIVE_INFINITY;
      if (matches < minimum || matches > maximum) {
        issues.push({
          path,
          message: `Expected between ${minimum} and ${maximum} matching items, received ${matches}`,
        });
      }
    }
  }

  if (typeof value === 'string') {
    if (
      typeof schema.minLength === 'number' &&
      value.length < schema.minLength
    ) {
      issues.push({
        path,
        message: `Expected at least ${schema.minLength} characters`,
      });
    }
    if (
      typeof schema.maxLength === 'number' &&
      value.length > schema.maxLength
    ) {
      issues.push({
        path,
        message: `Expected at most ${schema.maxLength} characters`,
      });
    }
    if (
      typeof schema.pattern === 'string' &&
      !new RegExp(schema.pattern).test(value)
    ) {
      issues.push({ path, message: `Value does not match ${schema.pattern}` });
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      issues.push({
        path,
        message: `Expected a value of at least ${schema.minimum}`,
      });
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      issues.push({
        path,
        message: `Expected a value of at most ${schema.maximum}`,
      });
    }
  }
}

export function validateAgainstJsonSchema(
  value: unknown,
  schema: JsonSchema,
): JsonSchemaIssue[] {
  assertSupportedSchema(schema);
  const issues: JsonSchemaIssue[] = [];
  validateValue(value, schema, schema, '', issues);
  return issues;
}

export async function runValidate(
  options: ValidateOptions,
): Promise<0 | 1> {
  const output = options.output ?? console.log;
  const manifestPath = join(options.rootDir, 'deployhub.yaml');
  const yamlText = await readFile(manifestPath, 'utf8');
  const document = parseDocument(yamlText);
  if (document.errors.length > 0) {
    for (const error of document.errors) {
      output(`ERROR YAML: ${error.message}`);
    }
    return 1;
  }

  const schemaResult = await (
    options.schemaLoader ??
    (() =>
      getManifestSchema({
        baseUrl: options.baseUrl,
        cachePath: options.cachePath,
        fetchImpl: options.fetchImpl,
      }))
  )();
  const localIssues = validateAgainstJsonSchema(
    document.toJS(),
    schemaResult.schema,
  );
  for (const issue of localIssues) {
    output(`ERROR ${issue.path || '<root>'}: ${issue.message}`);
  }
  if (localIssues.length === 0) {
    output(
      `Valid deployhub.yaml (schema ${schemaResult.version} from ${schemaResult.source})`,
    );
  }

  if (!options.remote) return localIssues.length === 0 ? 0 : 1;

  const remoteResult = await (
    options.remoteValidator ??
    ((body) =>
      validateRemoteManifest({
        baseUrl: options.baseUrl,
        yamlText: body,
        fetchImpl: options.fetchImpl,
      }))
  )(yamlText);
  if (!remoteResult.ok) {
    for (const issue of remoteResult.errors) {
      output(
        `REMOTE ${issue.severity.toUpperCase()} ${issue.path || '<root>'}: ${issue.message}`,
      );
    }
  }
  const localOk = localIssues.length === 0;
  if (localOk !== remoteResult.ok) {
    output('Local and remote validation results differ');
  } else {
    output('Local and remote validation results agree');
  }
  return localOk && remoteResult.ok ? 0 : 1;
}
