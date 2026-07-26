import { pgEnum } from 'drizzle-orm/pg-core';

export const projectStatus = pgEnum('project_status', [
  'active', 'paused', 'maintenance', 'archived',
]);

export const projectLifecycle = pgEnum('project_lifecycle', [
  'experimental', 'development', 'production', 'deprecated',
]);

export const componentType = pgEnum('component_type', [
  'frontend', 'backend', 'api', 'worker', 'scheduler', 'database',
  'authentication', 'storage', 'cache', 'queue', 'monitoring',
]);

export const resourceType = pgEnum('resource_type', [
  'vercel_project', 'vercel_deployment', 'supabase_project', 'hostinger_vps',
  'docker_container', 'docker_image', 'github_repository', 'domain',
  'database', 'storage_bucket', 'external_api',
]);

export const relationType = pgEnum('relation_type', [
  'runs_on', 'deployed_to', 'uses', 'depends_on', 'exposed_by', 'monitored_by',
]);

export const linkedBy = pgEnum('linked_by', [
  'manifest', 'label', 'repository', 'user', 'suggested',
]);

export const providerType = pgEnum('provider_type', [
  'github', 'vercel', 'supabase', 'hostinger', 'docker',
]);

export const jobStatus = pgEnum('job_status', [
  'pending', 'running', 'succeeded', 'failed',
]);

export const draftStatus = pgEnum('draft_status', [
  'draft', 'validation_failed', 'pending_review', 'approved', 'rejected', 'superseded',
]);

export const draftSourceType = pgEnum('draft_source_type', ['cli', 'manual']);

export const submitterType = pgEnum('submitter_type', ['token', 'user']);
