import { describe, expect, it } from 'vitest';
import inspect from '../../test/fixtures/docker-inspect.json';
import {
  normalizeDockerContainer,
  normalizeDockerDeployment,
} from './normalize';

const metadataKeys = [
  'composeProject',
  'composeService',
  'createdAt',
  'envKeys',
  'health',
  'image',
  'imageId',
  'labels',
  'mounts',
  'networks',
  'restartCount',
  'startedAt',
];

describe('Docker normalization', () => {
  it('keeps the full container identity and removes the name slash', () => {
    expect(normalizeDockerContainer(inspect)).toMatchObject({
      provider: 'docker',
      externalId: inspect.Id,
      resourceType: 'docker_container',
      name: 'deployhub-postgres',
    });
  });

  it('normalizes container and health status', () => {
    const resource = normalizeDockerContainer(inspect);

    expect(resource.status).toBe('running');
    expect(resource.metadata.health).toBe('healthy');
  });

  it('keeps the configured image name', () => {
    expect(normalizeDockerContainer(inspect).metadata.image).toBe(
      'postgres:17-alpine',
    );
  });

  it('keeps the declared labels', () => {
    expect(normalizeDockerContainer(inspect).metadata.labels).toMatchObject({
      'deployhub.project': 'deployhub',
      'deployhub.component': 'database',
    });
  });

  it('keeps only environment variable names split at the first equals sign', () => {
    expect(normalizeDockerContainer(inspect).metadata.envKeys).toEqual([
      'POSTGRES_USER',
      'POSTGRES_PASSWORD',
      'PATH',
    ]);
  });

  it('does not retain environment variable values anywhere', () => {
    const result = JSON.stringify(normalizeDockerContainer(inspect));

    expect(result).not.toContain('SUPER_SECRET_SHOULD_NOT_APPEAR');
  });

  it('does not retain command arguments anywhere', () => {
    const result = JSON.stringify(normalizeDockerContainer(inspect));

    expect(result).not.toContain('ALSO_SECRET');
  });

  it('keeps only allowlisted mount fields without host paths', () => {
    const mounts = normalizeDockerContainer(inspect).metadata.mounts;

    expect(mounts).toEqual([{
      type: 'volume',
      name: 'postgres_data',
      destination: '/var/lib/postgresql/data',
    }]);
    expect(JSON.stringify(mounts)).not.toContain(
      '/var/lib/docker/volumes/postgres_data/_data',
    );
    expect(
      (mounts as Array<Record<string, unknown>>).map((mount) =>
        Object.keys(mount).sort()
      ),
    ).toEqual([['destination', 'name', 'type']]);
  });

  it('uses exactly the metadata allowlist', () => {
    const keys = Object.keys(
      normalizeDockerContainer(inspect).metadata,
    ).sort();

    expect(keys).toEqual(metadataKeys);
  });

  it('normalizes Docker Compose labels', () => {
    const metadata = normalizeDockerContainer(inspect).metadata;

    expect(metadata.composeProject).toBe('docker');
    expect(metadata.composeService).toBe('postgres');
  });

  it('emits an ISO 8601 observation time', () => {
    const { observedAt } = normalizeDockerContainer(inspect);

    expect(new Date(observedAt).toISOString()).toBe(observedAt);
  });

  it('uses the same full container id for the resource and deployment', () => {
    const resource = normalizeDockerContainer(inspect);
    const deployment = normalizeDockerDeployment(inspect);

    expect(deployment.resourceExternalId).toBe(resource.externalId);
    expect(deployment.externalDeploymentId).toBe(inspect.Id);
  });
});
