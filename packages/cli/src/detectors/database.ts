import { access, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Manifest } from '@deployhub/manifest';
import type { DetectedComponent } from './node';

type Component = Manifest['spec']['components'][number];

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function detectDatabaseComponent(
  rootDir: string,
): Promise<DetectedComponent | undefined> {
  const prismaPath = 'prisma/schema.prisma';
  if (await exists(join(rootDir, prismaPath))) {
    const component: Component = {
      name: 'database',
      type: 'database',
      framework: 'prisma',
      path: prismaPath,
    };
    return {
      component,
      sources: {
        name: {
          origin: 'detected',
          evidence: prismaPath,
          source: prismaPath,
        },
        type: {
          origin: 'detected',
          evidence: prismaPath,
          source: prismaPath,
        },
        framework: {
          origin: 'detected',
          evidence: prismaPath,
          source: prismaPath,
        },
        runtime: { origin: 'unknown' },
        language: { origin: 'unknown' },
        criticality: { origin: 'unknown' },
        path: {
          origin: 'detected',
          evidence: prismaPath,
          source: prismaPath,
        },
      },
    };
  }

  const entries = await readdir(rootDir);
  const drizzleConfig = entries.find((name) =>
    /^drizzle\.config\.[cm]?[jt]s$/.test(name),
  );
  if (!drizzleConfig) return undefined;

  return {
    component: {
      name: 'database',
      type: 'database',
      framework: 'drizzle',
      path: drizzleConfig,
    },
    sources: {
      name: {
        origin: 'detected',
        evidence: drizzleConfig,
        source: drizzleConfig,
      },
      type: {
        origin: 'detected',
        evidence: drizzleConfig,
        source: drizzleConfig,
      },
      framework: {
        origin: 'detected',
        evidence: drizzleConfig,
        source: drizzleConfig,
      },
      runtime: { origin: 'unknown' },
      language: { origin: 'unknown' },
      criticality: { origin: 'unknown' },
      path: {
        origin: 'detected',
        evidence: drizzleConfig,
        source: drizzleConfig,
      },
    },
  };
}
