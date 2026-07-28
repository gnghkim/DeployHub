export { createGithubCollector, normalizeRepository } from './github';
export type { RepoExtra } from './github';
export {
  createVercelCollector,
  normalizeVercelDeployment,
  normalizeVercelProject,
} from './vercel';
export type { VercelEnvironmentVariable } from './vercel';
export {
  createDockerCollector,
  normalizeDockerContainer,
  normalizeDockerDeployment,
} from './docker';
export type {
  DockerCollector,
  DockerContainerSnapshot,
} from './docker';
export { checkHttp } from './health';
export type { HealthResult } from './health';
export type {
  ConnectionResult,
  DeploymentCollector,
  ExternalDeployment,
  ExternalResource,
  ProviderCollector,
  VercelCollector,
} from './types';
