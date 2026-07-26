import { diffManifest } from '@deployhub/manifest';
import {
  getCurrentProject,
  submitProjectDraft,
} from '../api';
import { detectProject, type DetectionResult } from '../detectors/index';
import {
  absoluteDeployHubUrl,
  readLocalManifest,
  validateWithServerSchema,
  type CommandOutput,
  type CommandValidator,
} from './shared';

export type SyncOptions = {
  rootDir: string;
  baseUrl: string;
  token: string;
  output?: CommandOutput;
  fetchImpl?: typeof fetch;
  validate?: CommandValidator;
  detector?: (rootDir: string) => Promise<DetectionResult>;
};

export async function runSync(options: SyncOptions): Promise<0 | 1> {
  const output = options.output ?? console.log;
  if (!options.token.trim()) {
    throw new Error('DEPLOYHUB_TOKEN environment variable is required');
  }

  const local = await readLocalManifest(options.rootDir, output);
  if (!local) return 1;

  const validationExitCode = await (
    options.validate ?? validateWithServerSchema
  )(options.rootDir, options.baseUrl, output);
  if (validationExitCode !== 0) return 1;

  const current = await getCurrentProject({
    baseUrl: options.baseUrl,
    slug: local.manifest.metadata.slug,
    fetchImpl: options.fetchImpl,
  });
  const detection = await (options.detector ?? detectProject)(options.rootDir);
  const draft = await submitProjectDraft({
    baseUrl: options.baseUrl,
    token: options.token,
    manifestYaml: local.yamlText,
    fieldSources: detection.fieldSources,
    diff: diffManifest(local.manifest, current),
    fetchImpl: options.fetchImpl,
  });
  output(
    `Draft submitted: ${absoluteDeployHubUrl(options.baseUrl, draft.url)}`,
  );
  return 0;
}
