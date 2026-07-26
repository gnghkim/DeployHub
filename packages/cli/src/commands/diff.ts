import { diffManifest, type ManifestDiff } from '@deployhub/manifest';
import { getCurrentProject } from '../api';
import {
  readLocalManifest,
  type CommandOutput,
} from './shared';

export type DiffOptions = {
  rootDir: string;
  baseUrl: string;
  output?: CommandOutput;
  fetchImpl?: typeof fetch;
};

function value(value: string | null): string {
  return value ?? '(none)';
}

export function printManifestDiff(
  diff: ManifestDiff,
  output: CommandOutput,
): void {
  const hasChanges =
    diff.project.length > 0
    || diff.componentsAdded.length > 0
    || diff.componentsChanged.length > 0
    || diff.componentsRemoved.length > 0
    || diff.domainsAdded.length > 0
    || diff.domainsRemoved.length > 0;
  if (!hasChanges) {
    output('No declarative changes.');
    return;
  }

  if (diff.project.length > 0) {
    output('Project changes:');
    for (const change of diff.project) {
      output(`  ${change.field}: ${value(change.from)} -> ${value(change.to)}`);
    }
  }
  if (diff.componentsAdded.length > 0) {
    output(`Components added: ${diff.componentsAdded.join(', ')}`);
  }
  if (diff.componentsChanged.length > 0) {
    output('Component changes:');
    for (const change of diff.componentsChanged) {
      output(
        `  ${change.name}.${change.field}: ${value(change.from)} -> ${value(change.to)}`,
      );
    }
  }
  if (diff.componentsRemoved.length > 0) {
    output(
      `Components absent from manifest (not automatically deleted): ${diff.componentsRemoved.join(', ')}`,
    );
  }
  if (diff.domainsAdded.length > 0) {
    output(`Domains added: ${diff.domainsAdded.join(', ')}`);
  }
  if (diff.domainsRemoved.length > 0) {
    output(`Domains absent from manifest: ${diff.domainsRemoved.join(', ')}`);
  }
}

export async function runDiff(options: DiffOptions): Promise<0 | 1> {
  const output = options.output ?? console.log;
  const local = await readLocalManifest(options.rootDir, output);
  if (!local) return 1;

  const current = await getCurrentProject({
    baseUrl: options.baseUrl,
    slug: local.manifest.metadata.slug,
    fetchImpl: options.fetchImpl,
  });
  printManifestDiff(diffManifest(local.manifest, current), output);
  return 0;
}
