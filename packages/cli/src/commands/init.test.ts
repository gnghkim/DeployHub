import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { runInit } from './init';

const fixture = fileURLToPath(
  new URL('../../test/fixtures/nextjs-monorepo/', import.meta.url),
);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function projectCopy(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), 'deployhub-init-'));
  temporaryDirectories.push(rootDir);
  await cp(fixture, rootDir, { recursive: true });
  return rootDir;
}

describe('runInit', () => {
  it('writes a detected manifest with the schema header and review fields', async () => {
    const rootDir = await projectCopy();
    const output: string[] = [];

    const result = await runInit({
      rootDir,
      detect: true,
      schemaUrl: 'https://hub.example/schemas/deployhub-v1.json',
      output: (line) => output.push(line),
    });

    const manifestText = await readFile(
      join(rootDir, 'deployhub.yaml'),
      'utf8',
    );
    expect(result.path).toBe(join(rootDir, 'deployhub.yaml'));
    expect(manifestText.split(/\r?\n/, 1)[0]).toBe(
      '# yaml-language-server: $schema=https://hub.example/schemas/deployhub-v1.json',
    );
    expect(manifestText).toContain('name: web');
    expect(manifestText).toContain('name: database');
    expect(manifestText).not.toContain('SHOULD_NOT_APPEAR_abc123');
    expect(output.join('\n')).toContain('UNKNOWN FIELDS');
    expect(output.join('\n')).toContain('web.criticality');
    expect(output.join('\n')).toContain('INFERRED FIELDS');
  });

  it('requires --force before overwriting an existing manifest', async () => {
    const rootDir = await projectCopy();
    const manifestPath = join(rootDir, 'deployhub.yaml');
    await writeFile(manifestPath, 'existing: true\n');

    await expect(
      runInit({
        rootDir,
        detect: true,
        schemaUrl: 'https://hub.example/schemas/deployhub-v1.json',
        output: () => undefined,
      }),
    ).rejects.toThrow('already exists; use --force to overwrite it');
    expect(await readFile(manifestPath, 'utf8')).toBe('existing: true\n');
  });

  it('overwrites an existing manifest when --force is given', async () => {
    const rootDir = await projectCopy();
    const manifestPath = join(rootDir, 'deployhub.yaml');
    await writeFile(manifestPath, 'existing: true\n');

    await runInit({
      rootDir,
      detect: true,
      force: true,
      schemaUrl: 'https://hub.example/schemas/deployhub-v1.json',
      output: () => undefined,
    });

    expect(await readFile(manifestPath, 'utf8')).toContain(
      'apiVersion: deployhub.io/v1',
    );
  });

  it('requires detection mode until interactive init is implemented', async () => {
    await expect(
      runInit({
        rootDir: await projectCopy(),
        detect: false,
        schemaUrl: 'https://hub.example/schemas/deployhub-v1.json',
        output: () => undefined,
      }),
    ).rejects.toThrow('deployhub init currently requires --detect');
  });
});
