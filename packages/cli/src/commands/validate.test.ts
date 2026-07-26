import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  manifestJsonSchema,
  type ParseResult,
} from '@deployhub/manifest';
import { afterEach, describe, expect, it } from 'vitest';
import {
  runValidate,
  validateAgainstJsonSchema,
} from './validate';

const schema = {
  type: 'object',
  required: ['apiVersion', 'kind'],
  properties: {
    apiVersion: { const: 'deployhub.io/v1' },
    kind: { const: 'Project' },
  },
  additionalProperties: false,
};
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function manifestProject(yamlText: string): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), 'deployhub-validate-'));
  temporaryDirectories.push(rootDir);
  await writeFile(join(rootDir, 'deployhub.yaml'), yamlText);
  return rootDir;
}

describe('validateAgainstJsonSchema', () => {
  it('reports required, constant, and additional-property violations', () => {
    expect(
      validateAgainstJsonSchema(
        { apiVersion: 'wrong', extra: true },
        schema,
      ),
    ).toEqual([
      {
        path: 'apiVersion',
        message: 'Expected constant value "deployhub.io/v1"',
      },
      { path: 'kind', message: 'Required field is missing' },
      { path: 'extra', message: 'Unknown field is not allowed' },
    ]);
  });

  it('validates the JSON Schema shape served by DeployHub', () => {
    const validManifest = {
      apiVersion: 'deployhub.io/v1',
      kind: 'Project',
      metadata: {
        name: 'DeployHub',
        slug: 'deployhub',
      },
      spec: {
        lifecycle: 'development',
        components: [{ name: 'web', type: 'frontend' }],
      },
    };

    expect(
      validateAgainstJsonSchema(validManifest, manifestJsonSchema()),
    ).toEqual([]);
    expect(
      validateAgainstJsonSchema(
        { ...validManifest, unexpected: true },
        manifestJsonSchema(),
      ),
    ).toContainEqual({
      path: 'unexpected',
      message: 'Unknown field is not allowed',
    });
  });

  it('requires exactly one oneOf branch to match', () => {
    expect(
      validateAgainstJsonSchema(1, {
        oneOf: [{ type: 'number' }, { type: 'integer' }],
      }),
    ).toEqual([
      {
        path: '',
        message: 'Expected exactly one matching schema, received 2',
      },
    ]);
  });

  it('supports negation and boolean schemas without false successes', () => {
    expect(
      validateAgainstJsonSchema('secret', { not: { const: 'secret' } }),
    ).toEqual([{ path: '', message: 'Value matches a forbidden schema' }]);
    expect(
      validateAgainstJsonSchema(
        'anything',
        false as unknown as Record<string, unknown>,
      ),
    ).toEqual([{ path: '', message: 'Value is forbidden by schema' }]);
  });

  it('fails closed when the server uses an unsupported assertion keyword', () => {
    expect(() =>
      validateAgainstJsonSchema('value', {
        futureAssertion: { enabled: true },
      }),
    ).toThrow('Unsupported JSON Schema keyword: futureAssertion');
  });

  it('applies properties and every matching patternProperties schema', () => {
    expect(
      validateAgainstJsonSchema(
        { foo: 'x' },
        {
          type: 'object',
          properties: { foo: { type: 'string' } },
          patternProperties: { '^foo$': { minLength: 3 } },
        },
      ),
    ).toEqual([
      { path: 'foo', message: 'Expected at least 3 characters' },
    ]);
  });

  it('uses structural JSON equality for const, oneOf, and uniqueItems', () => {
    expect(
      validateAgainstJsonSchema(
        { a: 1 },
        {
          oneOf: [
            { type: 'object' },
            { const: { a: 1 } },
          ],
        },
      ),
    ).toEqual([
      {
        path: '',
        message: 'Expected exactly one matching schema, received 2',
      },
    ]);
    expect(
      validateAgainstJsonSchema(
        [
          { a: 1, b: 2 },
          { b: 2, a: 1 },
        ],
        { type: 'array', uniqueItems: true },
      ),
    ).toEqual([{ path: '', message: 'Array items must be unique' }]);
  });
});

describe('runValidate', () => {
  it('validates deployhub.yaml with the fetched server schema', async () => {
    const rootDir = await manifestProject(
      'apiVersion: deployhub.io/v1\nkind: Project\n',
    );
    const output: string[] = [];

    const exitCode = await runValidate({
      rootDir,
      baseUrl: 'https://hub.example',
      remote: false,
      output: (line) => output.push(line),
      schemaLoader: async () => ({
        schema,
        version: 'deployhub.io/v1',
        source: 'server',
      }),
    });

    expect(exitCode).toBe(0);
    expect(output).toContain(
      'Valid deployhub.yaml (schema deployhub.io/v1 from server)',
    );
  });

  it('prints local schema violations and returns a failure exit code', async () => {
    const rootDir = await manifestProject(
      'apiVersion: deployhub.io/v1\nextra: true\n',
    );
    const output: string[] = [];

    const exitCode = await runValidate({
      rootDir,
      baseUrl: 'https://hub.example',
      remote: false,
      output: (line) => output.push(line),
      schemaLoader: async () => ({
        schema,
        version: 'deployhub.io/v1',
        source: 'cache',
      }),
    });

    expect(exitCode).toBe(1);
    expect(output.join('\n')).toContain(
      'ERROR kind: Required field is missing',
    );
  });

  it('compares local validation with the remote server verdict', async () => {
    const rootDir = await manifestProject(
      'apiVersion: deployhub.io/v1\nkind: Project\n',
    );
    const output: string[] = [];
    const remoteResult: ParseResult = {
      ok: false,
      errors: [
        {
          path: 'metadata',
          message: 'Required',
          severity: 'error',
        },
      ],
    };

    const exitCode = await runValidate({
      rootDir,
      baseUrl: 'https://hub.example',
      remote: true,
      output: (line) => output.push(line),
      schemaLoader: async () => ({
        schema,
        version: 'deployhub.io/v1',
        source: 'server',
      }),
      remoteValidator: async () => remoteResult,
    });

    expect(exitCode).toBe(1);
    expect(output.join('\n')).toContain(
      'REMOTE ERROR metadata: Required',
    );
    expect(output.join('\n')).toContain(
      'Local and remote validation results differ',
    );
  });
});
