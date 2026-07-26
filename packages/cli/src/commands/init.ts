import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify } from 'yaml';
import {
  detectProject,
  type DetectionResult,
  type FieldSource,
} from '../detectors/index';

export type InitOptions = {
  rootDir: string;
  detect: boolean;
  force?: boolean;
  schemaUrl: string;
  output?: (line: string) => void;
  detector?: (rootDir: string) => Promise<DetectionResult>;
};

export type InitResult = {
  path: string;
  detection: DetectionResult;
};

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function reviewFields(
  fieldSources: DetectionResult['fieldSources'],
  origin: FieldSource['origin'],
): string[] {
  return Object.entries(fieldSources)
    .flatMap(([component, fields]) =>
      Object.entries(fields)
        .filter(([, source]) => source.origin === origin)
        .map(([field]) => `${component}.${field}`),
    )
    .sort();
}

function printReviewSection(
  output: (line: string) => void,
  title: string,
  fields: readonly string[],
): void {
  output(title);
  if (fields.length === 0) {
    output('  (none)');
    return;
  }
  for (const field of fields) output(`  - ${field}`);
}

export async function runInit(options: InitOptions): Promise<InitResult> {
  if (!options.detect) {
    throw new Error('deployhub init currently requires --detect');
  }

  const output = options.output ?? console.log;
  const manifestPath = join(options.rootDir, 'deployhub.yaml');
  if (!options.force && (await exists(manifestPath))) {
    throw new Error(
      `${manifestPath} already exists; use --force to overwrite it`,
    );
  }

  const detection = await (options.detector ?? detectProject)(options.rootDir);
  const header = `# yaml-language-server: $schema=${options.schemaUrl}`;
  const yamlText = `${header}\n${stringify(detection.manifest, {
    lineWidth: 0,
  })}`;
  await writeFile(manifestPath, yamlText);

  output(`Wrote ${manifestPath}`);
  printReviewSection(
    output,
    'INFERRED FIELDS — review before approval',
    reviewFields(detection.fieldSources, 'inferred'),
  );
  printReviewSection(
    output,
    'UNKNOWN FIELDS — values were not guessed and are omitted',
    reviewFields(detection.fieldSources, 'unknown'),
  );
  for (const note of detection.notes) output(`NOTE ${note}`);

  return { path: manifestPath, detection };
}
