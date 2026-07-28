import {
  getProjectStatus,
  ProjectNotFoundError,
} from '../api';
import {
  absoluteDeployHubUrl,
  readLocalManifest,
  type CommandOutput,
} from './shared';

export type StatusOptions = {
  rootDir: string;
  baseUrl: string;
  token: string;
  output?: CommandOutput;
  fetchImpl?: typeof fetch;
};

export async function runStatus(options: StatusOptions): Promise<0 | 1> {
  const output = options.output ?? console.log;
  if (!options.token.trim()) {
    throw new Error('DEPLOYHUB_TOKEN environment variable is required');
  }
  const local = await readLocalManifest(options.rootDir, output);
  if (!local) return 1;

  let status;
  try {
    status = await getProjectStatus({
      baseUrl: options.baseUrl,
      slug: local.manifest.metadata.slug,
      token: options.token,
      fetchImpl: options.fetchImpl,
    });
  } catch (error) {
    if (error instanceof ProjectNotFoundError) {
      output('Registration: not registered');
      return 0;
    }
    throw error;
  }
  output(`Registration: ${status.registered ? 'registered' : 'not registered'}`);
  output(`Project: ${status.name ?? status.slug} (${status.status ?? 'unknown'})`);
  output(`Lifecycle: ${status.lifecycle ?? 'unknown'}`);
  output(`Components: ${status.componentCount}`);
  output(`Linked resources: ${status.linkedResourceCount}`);
  if (status.latestDraft) {
    output(`Latest Draft: ${status.latestDraft.status}`);
    output(
      `Draft URL: ${absoluteDeployHubUrl(
        options.baseUrl,
        `/settings/drafts/${status.latestDraft.id}`,
      )}`,
    );
  } else {
    output('Latest Draft: none');
  }
  if (status.projectUrl) {
    output(
      `URL: ${absoluteDeployHubUrl(options.baseUrl, status.projectUrl)}`,
    );
  }
  return 0;
}
