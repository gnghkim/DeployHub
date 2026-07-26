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

export interface ProviderCollector {
  readonly provider: ExternalResource['provider'];
  testConnection(): Promise<ConnectionResult>;
  listResources(): Promise<ExternalResource[]>;
}
