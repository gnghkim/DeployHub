import { detectProject, type DetectionResult } from '../detectors/index';
import { submitProjectDraft } from '../api';
import {
  absoluteDeployHubUrl,
  readLocalManifest,
  validateWithServerSchema,
  type CommandOutput,
  type CommandValidator,
} from './shared';

export type RegisterOptions = {
  rootDir: string;
  baseUrl: string;
  token: string;
  output?: CommandOutput;
  fetchImpl?: typeof fetch;
  validate?: CommandValidator;
  detector?: (rootDir: string) => Promise<DetectionResult>;
};

export async function runRegister(
  options: RegisterOptions,
): Promise<0 | 1> {
  const output = options.output ?? console.log;
  if (!options.token.trim()) {
    throw new Error('DEPLOYHUB_TOKEN environment variable is required');
  }

  // Parse with the bundled manifest model before any network call. This
  // catches malformed or obsolete files without consuming a token.
  const local = await readLocalManifest(options.rootDir, output);
  if (!local) return 1;

  const validationExitCode = await (
    options.validate ?? validateWithServerSchema
  )(options.rootDir, options.baseUrl, output);
  if (validationExitCode !== 0) return 1;

  const detection = await (options.detector ?? detectProject)(options.rootDir);
  const draft = await submitProjectDraft({
    baseUrl: options.baseUrl,
    token: options.token,
    manifestYaml: local.yamlText,
    fieldSources: detection.fieldSources,
    fetchImpl: options.fetchImpl,
  });
  output(
    `Draft submitted: ${absoluteDeployHubUrl(options.baseUrl, draft.url)}`,
  );
  return 0;
}
