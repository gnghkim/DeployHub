import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Manifest } from '@deployhub/manifest';
import { detectDatabaseComponent } from './database';
import { detectComposeServices, hasDockerfile } from './docker';
import {
  detectGitHubRepository,
  detectGitHubWorkflows,
} from './github';
import {
  detectNodeComponents,
  type DetectedComponent,
  type NodeDetectionRule,
} from './node';

export type FieldSource = {
  origin: 'declared' | 'detected' | 'inferred' | 'unknown';
  evidence?: string;
  source?: string;
};

export type DetectionResult = {
  manifest: Partial<Manifest>;
  fieldSources: Record<string, Record<string, FieldSource>>;
  notes: string[];
};

// Kept as data so M2 can move the fingerprint rules into a shared package.
export const DETECTION_RULES: readonly NodeDetectionRule[] = [
  {
    dependency: 'next',
    type: 'frontend',
    framework: 'nextjs',
    runtime: 'nodejs',
  },
  {
    dependency: 'express',
    type: 'backend',
    framework: 'express',
    runtime: 'nodejs',
  },
  {
    packageNamePattern: /worker/i,
    type: 'worker',
    runtime: 'nodejs',
  },
];

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function detectPythonComponent(
  rootDir: string,
): Promise<DetectedComponent | undefined> {
  const requirementPath = join(rootDir, 'requirements.txt');
  const pyprojectPath = join(rootDir, 'pyproject.toml');
  let evidence: string | undefined;
  let source: string | undefined;

  if (await exists(requirementPath)) {
    const requirements = await readFile(requirementPath, 'utf8');
    evidence = requirements.match(/^fastapi(?:==|~=|>=|<=|>|<)?[^\s;]*/im)?.[0];
    if (evidence) source = 'requirements.txt';
  }
  if (!evidence && (await exists(pyprojectPath))) {
    const pyproject = await readFile(pyprojectPath, 'utf8');
    evidence = pyproject.match(/fastapi(?:==|~=|>=|<=|>|<)?[0-9.]+/i)?.[0];
    if (evidence) source = 'pyproject.toml';
  }
  if (!evidence || !source) return undefined;

  return {
    component: {
      name: 'api',
      type: 'api',
      framework: 'fastapi',
      runtime: 'python',
      language: 'python',
      path: '.',
    },
    sources: {
      name: { origin: 'detected', evidence, source },
      type: { origin: 'detected', evidence, source },
      framework: { origin: 'detected', evidence, source },
      runtime: { origin: 'detected', evidence, source },
      language: { origin: 'detected', evidence, source },
      criticality: { origin: 'unknown' },
      path: { origin: 'detected', evidence: source, source },
    },
  };
}

async function declaredEnvironmentKeys(rootDir: string): Promise<string[]> {
  const examplePath = join(rootDir, '.env.example');
  if (!(await exists(examplePath))) return [];

  const contents = await readFile(examplePath, 'utf8');
  return contents
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1])
    .filter((key): key is string => key !== undefined)
    .sort();
}

function appendComposeEvidence(
  detection: DetectedComponent,
  composeFilename: string,
): void {
  const typeSource = detection.sources.type;
  if (!typeSource || typeSource.origin !== 'detected') return;
  typeSource.evidence = `${typeSource.evidence}; ${composeFilename} service ${detection.component.name}`;
}

export async function detectProject(
  rootDir: string,
): Promise<DetectionResult> {
  const notes: string[] = [];
  const detections = await detectNodeComponents(rootDir, DETECTION_RULES);
  const python = await detectPythonComponent(rootDir);
  if (python) detections.push(python);
  const database = await detectDatabaseComponent(rootDir);
  if (database) detections.push(database);

  const compose = await detectComposeServices(rootDir);
  if (compose.filename) {
    for (const service of compose.services) {
      const detection = detections.find(
        ({ component }) => component.name === service,
      );
      if (detection) {
        appendComposeEvidence(detection, compose.filename);
      } else {
        notes.push(`Compose service candidate: ${service} (${compose.filename})`);
      }
    }
  }
  if (await hasDockerfile(rootDir)) {
    notes.push('Detected Dockerfile: Dockerfile');
  }

  for (const workflow of await detectGitHubWorkflows(rootDir)) {
    notes.push(`Detected GitHub Actions workflow: ${workflow}`);
  }

  const environmentKeys = await declaredEnvironmentKeys(rootDir);
  if (environmentKeys.length > 0) {
    notes.push(
      `Environment keys declared in .env.example: ${environmentKeys.join(', ')}`,
    );
  }

  const repository = await detectGitHubRepository(rootDir);
  const components = detections.map(({ component }) => component);
  const spec = {
    components,
    ...(repository
      ? {
          repository: {
            provider: 'github' as const,
            slug: repository.slug,
          },
        }
      : {}),
  } as Manifest['spec'];

  return {
    manifest: {
      apiVersion: 'deployhub.io/v1',
      kind: 'Project',
      spec,
    },
    fieldSources: {
      '$project': {
        'metadata.name': { origin: 'unknown' },
        'metadata.slug': { origin: 'unknown' },
        'spec.lifecycle': { origin: 'unknown' },
        'repository.slug': repository
          ? {
              origin: 'detected',
              evidence: repository.evidence,
              source: repository.source,
            }
          : { origin: 'unknown' },
      },
      ...Object.fromEntries(
        detections.map(({ component, sources }) => [component.name, sources]),
      ),
    },
    notes,
  };
}
