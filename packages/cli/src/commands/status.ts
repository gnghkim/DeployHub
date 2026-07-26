import { getProjectStatus } from '../api';
import {
  absoluteDeployHubUrl,
  readLocalManifest,
  type CommandOutput,
} from './shared';

export type StatusOptions = {
  rootDir: string;
  baseUrl: string;
  output?: CommandOutput;
  fetchImpl?: typeof fetch;
};

export async function runStatus(options: StatusOptions): Promise<0 | 1> {
  const output = options.output ?? console.log;
  const local = await readLocalManifest(options.rootDir, output);
  if (!local) return 1;

  const status = await getProjectStatus({
    baseUrl: options.baseUrl,
    slug: local.manifest.metadata.slug,
    fetchImpl: options.fetchImpl,
  });
  output(`Registration: ${status.registered ? 'registered' : 'not registered'}`);
  output(`Project: ${status.projectStatus}`);
  output(`Connection: ${status.connectionStatus}`);
  if (status.projectUrl) {
    output(
      `URL: ${absoluteDeployHubUrl(options.baseUrl, status.projectUrl)}`,
    );
  }
  return 0;
}
