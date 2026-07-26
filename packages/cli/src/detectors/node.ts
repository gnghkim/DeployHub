import { access, readFile } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';
import type { Manifest } from '@deployhub/manifest';
import type { FieldSource } from './index';

type Component = Manifest['spec']['components'][number];

export type NodeDetectionRule = {
  dependency?: string;
  packageNamePattern?: RegExp;
  type: Component['type'];
  framework?: string;
  runtime: string;
};

export type DetectedComponent = {
  component: Component;
  sources: Record<string, FieldSource>;
};

type PackageJson = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function cleanComponentName(value: string): string {
  const unscoped = value.split('/').at(-1) ?? value;
  return (
    unscoped
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'component'
  );
}

async function findPackageJsonFiles(rootDir: string): Promise<string[]> {
  const packageFiles: string[] = [];

  async function visit(directory: string): Promise<void> {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.isDirectory() &&
        !['node_modules', '.git', 'dist', '.next'].includes(entry.name)
      ) {
        await visit(join(directory, entry.name));
      } else if (entry.isFile() && entry.name === 'package.json') {
        packageFiles.push(join(directory, entry.name));
      }
    }
  }

  await visit(rootDir);
  return packageFiles.sort();
}

function detectRule(
  packageJson: PackageJson,
  rules: readonly NodeDetectionRule[],
): NodeDetectionRule | undefined {
  const dependencies = {
    ...packageJson.devDependencies,
    ...packageJson.dependencies,
  };
  return rules.find(
    (rule) =>
      (rule.dependency && dependencies[rule.dependency] !== undefined) ||
      (rule.packageNamePattern &&
        packageJson.name !== undefined &&
        rule.packageNamePattern.test(packageJson.name)),
  );
}

export async function detectNodeComponents(
  rootDir: string,
  rules: readonly NodeDetectionRule[],
): Promise<DetectedComponent[]> {
  const detections: DetectedComponent[] = [];

  for (const packageFile of await findPackageJsonFiles(rootDir)) {
    const packageJson = JSON.parse(
      await readFile(packageFile, 'utf8'),
    ) as PackageJson;
    const rule = detectRule(packageJson, rules);
    if (!rule) continue;

    const packageDirectory = dirname(packageFile);
    const componentPath = relative(rootDir, packageDirectory).replaceAll(
      '\\',
      '/',
    );
    const name = cleanComponentName(
      packageJson.name ?? basename(packageDirectory),
    );
    const dependencies = {
      ...packageJson.devDependencies,
      ...packageJson.dependencies,
    };
    const source = relative(rootDir, packageFile).replaceAll('\\', '/');
    const ruleEvidence = rule.dependency
      ? `${rule.dependency}@${dependencies[rule.dependency]}`
      : `package name ${packageJson.name}`;
    const hasTypeScript =
      dependencies.typescript !== undefined ||
      (await exists(join(packageDirectory, 'tsconfig.json')));

    const component: Component = {
      name,
      type: rule.type,
      runtime: rule.runtime,
      path: componentPath || '.',
      ...(rule.framework ? { framework: rule.framework } : {}),
      ...(hasTypeScript ? { language: 'typescript' } : {}),
    };
    detections.push({
      component,
      sources: {
        name: {
          origin: 'detected',
          evidence: packageJson.name ?? basename(packageDirectory),
          source,
        },
        type: { origin: 'detected', evidence: ruleEvidence, source },
        framework: rule.framework
          ? { origin: 'detected', evidence: ruleEvidence, source }
          : { origin: 'unknown' },
        runtime: { origin: 'detected', evidence: ruleEvidence, source },
        language: hasTypeScript
          ? {
              origin: 'detected',
              evidence:
                dependencies.typescript !== undefined
                  ? `typescript@${dependencies.typescript}`
                  : 'tsconfig.json',
              source:
                dependencies.typescript !== undefined
                  ? source
                  : `${componentPath}/tsconfig.json`.replace(/^\.\//, ''),
            }
          : { origin: 'unknown' },
        criticality: { origin: 'unknown' },
        path: {
          origin: 'detected',
          evidence: source,
          source,
        },
      },
    });
  }

  return detections;
}
