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
  extractContainerHealth,
  normalizeDockerContainer,
  normalizeDockerDeployment,
} from './docker';
export type {
  ContainerHealth,
  ContainerStatus,
  DockerCollector,
  DockerCollectorDependencies,
  DockerContainerSnapshot,
  DockerFetchImplementation,
} from './docker';
export { checkHttp } from './health';
export type { HealthResult } from './health';
export { fetchCertificate } from './tls';
export type { CertificateResult } from './tls';
export type {
  ConnectionResult,
  DeploymentCollector,
  ExternalDeployment,
  ExternalResource,
  ProviderCollector,
  VercelCollector,
} from './types';
