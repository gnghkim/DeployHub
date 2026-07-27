import { access, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { Manifest } from '@deployhub/manifest';
import { detectDatabaseComponent } from './database';
import {
  detectComposeServices,
  hasDockerfile,
  type ComposeService,
} from './docker';
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

type ProjectNameDetection = {
  name: string;
  source: FieldSource;
};

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function packageProjectName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const declaredName = value.trim();
  if (!declaredName) return undefined;
  const scoped = declaredName.match(/^@[^/]+\/(.+)$/);
  const name = (scoped?.[1] ?? declaredName).trim();
  return name || undefined;
}

function pyprojectName(
  contents: string,
): { name: string; section: 'project' | 'tool.poetry' } | undefined {
  let section = '';
  let projectName: string | undefined;
  let poetryName: string | undefined;

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1] ?? '';
      continue;
    }
    if (section !== 'project' && section !== 'tool.poetry') continue;
    const nameMatch = line.match(/^name\s*=\s*(["'])(.*?)\1\s*(?:#.*)?$/);
    const name = nameMatch?.[2]?.trim();
    if (!name) continue;
    if (section === 'project') projectName = name;
    if (section === 'tool.poetry') poetryName = name;
  }

  if (projectName) return { name: projectName, section: 'project' };
  if (poetryName) return { name: poetryName, section: 'tool.poetry' };
  return undefined;
}

async function detectProjectName(
  rootDir: string,
): Promise<ProjectNameDetection | undefined> {
  const packagePath = join(rootDir, 'package.json');
  if (await exists(packagePath)) {
    const packageJson = JSON.parse(
      await readFile(packagePath, 'utf8'),
    ) as { name?: unknown };
    const declaredName =
      typeof packageJson.name === 'string' ? packageJson.name.trim() : '';
    const name = packageProjectName(packageJson.name);
    if (name) {
      return {
        name,
        source: {
          origin: 'detected',
          evidence: `package.json name=${declaredName}`,
          source: 'package.json',
        },
      };
    }
  }

  const pyprojectPath = join(rootDir, 'pyproject.toml');
  if (await exists(pyprojectPath)) {
    const detected = pyprojectName(await readFile(pyprojectPath, 'utf8'));
    if (detected) {
      return {
        name: detected.name,
        source: {
          origin: 'detected',
          evidence: `pyproject.toml [${detected.section}] name=${detected.name}`,
          source: 'pyproject.toml',
        },
      };
    }
  }

  const directoryName = basename(resolve(rootDir)).trim();
  if (!directoryName) return undefined;
  return {
    name: directoryName,
    source: {
      origin: 'inferred',
      evidence: `directory name=${directoryName}`,
      source: '.',
    },
  };
}

function normalizeProjectSlug(name: string): string | undefined {
  const slug = name
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : undefined;
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
  service: ComposeService,
): void {
  const typeSource = detection.sources.type;
  if (typeSource?.origin === 'detected') {
    typeSource.evidence = `${typeSource.evidence}; ${composeFilename} service ${service.name}`;
  }

  const container = service.containerName ?? service.name;
  const serviceEvidence = `${composeFilename} service ${service.name}`;
  detection.component.container = container;
  detection.component.provider = 'docker';
  detection.sources.container = {
    origin: 'detected',
    evidence: service.containerName
      ? `${composeFilename} services.${service.name}.container_name=${container}`
      : serviceEvidence,
    source: composeFilename,
  };
  detection.sources.provider = {
    origin: 'inferred',
    evidence: serviceEvidence,
    source: composeFilename,
  };
}

function addDeploymentSourceDefaults(detection: DetectedComponent): void {
  detection.sources.provider = { origin: 'unknown' };
  detection.sources.externalRef = { origin: 'unknown' };
  detection.sources.container = { origin: 'unknown' };
  detection.sources.url = { origin: 'unknown' };
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
  detections.forEach(addDeploymentSourceDefaults);

  const compose = await detectComposeServices(rootDir);
  if (compose.filename) {
    for (const service of compose.services) {
      const detection = detections.find(
        ({ component }) => component.name === service.name,
      );
      if (detection) {
        appendComposeEvidence(detection, compose.filename, service);
      } else {
        notes.push(
          `Compose service candidate: ${service.name} (${compose.filename})`,
        );
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
  const projectName = await detectProjectName(rootDir);
  const projectSlug = projectName
    ? normalizeProjectSlug(projectName.name)
    : undefined;
  const metadata = projectName
    ? ({
        name: projectName.name,
        ...(projectSlug ? { slug: projectSlug } : {}),
      } as Manifest['metadata'])
    : undefined;
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
      ...(metadata ? { metadata } : {}),
      spec,
    },
    fieldSources: {
      '$project': {
        'metadata.name': projectName?.source ?? { origin: 'unknown' },
        'metadata.slug':
          projectName && projectSlug
            ? {
                origin: projectName.source.origin,
                evidence: `normalized from name=${projectName.name}`,
                source: projectName.source.source,
              }
            : { origin: 'unknown' },
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
