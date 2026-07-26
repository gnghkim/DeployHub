import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';

type ComposeDocument = {
  services?: Record<string, unknown>;
};

async function firstExisting(
  rootDir: string,
  names: readonly string[],
): Promise<string | undefined> {
  for (const name of names) {
    try {
      await access(join(rootDir, name));
      return name;
    } catch {
      // Try the next conventional Compose filename.
    }
  }
  return undefined;
}

export async function detectComposeServices(
  rootDir: string,
): Promise<{ filename?: string; services: string[] }> {
  const filename = await firstExisting(rootDir, [
    'compose.yaml',
    'compose.yml',
    'docker-compose.yaml',
    'docker-compose.yml',
  ]);
  if (!filename) return { services: [] };

  const document = parse(
    await readFile(join(rootDir, filename), 'utf8'),
  ) as ComposeDocument;
  return {
    filename,
    services: Object.keys(document.services ?? {}).sort(),
  };
}

export async function hasDockerfile(rootDir: string): Promise<boolean> {
  try {
    await access(join(rootDir, 'Dockerfile'));
    return true;
  } catch {
    return false;
  }
}
