export { createGithubCollector, normalizeRepository } from './github';
export type { RepoExtra } from './github';
export {
  createVercelCollector,
  normalizeVercelDeployment,
  normalizeVercelProject,
} from './vercel';
export type { VercelEnvironmentVariable } from './vercel';
export type {
  ConnectionResult,
  DeploymentCollector,
  ExternalDeployment,
  ExternalResource,
  ProviderCollector,
  VercelCollector,
} from './types';
