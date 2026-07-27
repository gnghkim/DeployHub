export type ExternalResource = {
  provider: 'github' | 'vercel' | 'supabase' | 'hostinger' | 'docker';
  externalId: string;
  resourceType:
    | 'github_repository'
    | 'vercel_project'
    | 'docker_container'
    | string;
  name: string;
  status?: string;
  region?: string;
  url?: string;
  metadata: Record<string, unknown>;
  observedAt: string;
};

export type ConnectionResult =
  | { ok: true; account: string }
  | { ok: false; error: string };

export type ExternalDeployment = {
  /** Provider resource that owns this deployment. */
  resourceExternalId: string;
  externalDeploymentId: string;
  environment: string;
  status: string;
  version?: string;
  commitSha?: string;
  imageName?: string;
  deploymentUrl?: string;
  startedAt?: string;
  completedAt?: string;
  metadata: Record<string, unknown>;
};

export interface ProviderCollector {
  readonly provider: ExternalResource['provider'];
  testConnection(): Promise<ConnectionResult>;
  listResources(): Promise<ExternalResource[]>;
}

export interface DeploymentCollector extends ProviderCollector {
  listDeployments(): Promise<ExternalDeployment[]>;
}

export type VercelCollector = DeploymentCollector;
