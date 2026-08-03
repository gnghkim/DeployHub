import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildComposition,
  type CompositionInput,
} from './composition-model';

const updatedAt = new Date('2026-08-04T00:00:00.000Z');

function input(
  overrides: Partial<CompositionInput> = {},
): CompositionInput {
  return {
    components: [],
    resources: [],
    observationContext: {
      accounts: [],
      activeJobs: [],
      dockerLastSyncAt: null,
    },
    ...overrides,
  };
}

describe('buildComposition', () => {
  it('keeps an unobserved component empty instead of copying its declaration', () => {
    const composition = buildComposition(input({
      components: [{
        id: 'worker',
        name: 'worker',
        componentType: 'worker',
        framework: null,
        runtime: 'nodejs',
        language: 'typescript',
        provider: 'hostinger',
        externalRef: null,
        containerName: 'deployhub-worker',
        updatedAt,
      }],
    }));

    expect(composition.rows[0]).toMatchObject({
      declaration: {
        name: 'worker',
        technology: 'Node',
      },
      observations: [{
        name: null,
        provider: null,
        status: null,
      }],
    });
    expect(composition.rows[0]?.observations).not.toContainEqual(
      expect.objectContaining({ name: 'deployhub-worker' }),
    );
    expect(composition.rows[0]?.observations[0]).not.toHaveProperty('missing');
  });

  it('returns components in a stable architecture order', () => {
    const components: CompositionInput['components'] = [
      {
        id: 'database',
        name: 'database',
        componentType: 'database',
        framework: null,
        runtime: 'postgresql',
        language: null,
        provider: 'self-hosted',
        externalRef: null,
        containerName: 'deployhub-postgres',
        updatedAt,
      },
      {
        id: 'worker',
        name: 'worker',
        componentType: 'worker',
        framework: null,
        runtime: 'nodejs',
        language: 'typescript',
        provider: 'hostinger',
        externalRef: null,
        containerName: 'deployhub-worker',
        updatedAt,
      },
      {
        id: 'web',
        name: 'web',
        componentType: 'frontend',
        framework: 'nextjs',
        runtime: 'nodejs',
        language: 'typescript',
        provider: 'hostinger',
        externalRef: null,
        containerName: 'deployhub-web',
        updatedAt,
      },
    ];

    const forward = buildComposition(input({ components }));
    const reversed = buildComposition(input({
      components: [...components].reverse(),
    }));

    expect(forward.rows.map((row) => row.declaration.name)).toEqual([
      'web',
      'worker',
      'database',
    ]);
    expect(reversed.rows).toEqual(forward.rows);
  });

  it('puts linked observation facts on the observation side', () => {
    const composition = buildComposition(input({
      components: [{
        id: 'web',
        name: 'web',
        componentType: 'frontend',
        framework: 'nextjs',
        runtime: 'nodejs',
        language: 'typescript',
        provider: 'hostinger',
        externalRef: null,
        containerName: 'declared-web',
        updatedAt,
      }],
      resources: [{
        id: 'resource-web',
        componentId: 'web',
        provider: 'docker',
        resourceType: 'docker_container',
        name: 'observed-web',
        status: 'running',
      }],
    }));

    expect(composition.rows[0]).toMatchObject({
      declaration: {
        name: 'web',
        technology: 'Next.js',
      },
      observations: [{
        name: 'observed-web',
        provider: 'docker',
        status: 'running',
      }],
    });
    expect(composition.rows[0]?.observations[0]).not.toHaveProperty('missing');
  });

  it('does not treat the repository node as a component runtime observation', () => {
    const composition = buildComposition(input({
      components: [{
        id: 'web',
        name: 'web',
        componentType: 'frontend',
        framework: 'nextjs',
        runtime: 'nodejs',
        language: 'typescript',
        provider: 'hostinger',
        externalRef: null,
        containerName: 'deployhub-web',
        updatedAt,
      }],
      resources: [{
        id: 'repository',
        componentId: 'web',
        provider: 'github',
        resourceType: 'github_repository',
        name: 'gnghkim/DeployHub',
        status: 'active',
      }],
    }));

    expect(composition.rows[0]?.observations).toEqual([
      expect.objectContaining({
        name: null,
      }),
    ]);
  });

  it('explains every missing-observation state in the observation column', () => {
    const baseComponent: CompositionInput['components'][number] = {
      id: 'service',
      name: 'service',
      componentType: 'backend',
      framework: null,
      runtime: 'nodejs',
      language: 'typescript',
      provider: 'supabase',
      externalRef: 'project-ref',
      containerName: null,
      updatedAt,
    };
    const message = (
      component: CompositionInput['components'][number],
      observationContext: CompositionInput['observationContext'],
    ) => buildComposition(input({
      components: [component],
      observationContext,
    })).rows[0]?.observations[0]?.message;

    expect(message(baseComponent, {
      accounts: [],
      activeJobs: [],
      dockerLastSyncAt: null,
    })).toBe('연결 필요');
    expect(message({ ...baseComponent, provider: 'vercel' }, {
      accounts: [{
        id: 'vercel-1',
        provider: 'vercel',
        lastSyncAt: null,
        lastError: null,
      }],
      activeJobs: [{
        type: 'vercel.sync',
        payload: { accountId: 'vercel-1' },
      }],
      dockerLastSyncAt: null,
    })).toBe('동기화 대기');
    expect(message({ ...baseComponent, containerName: 'service' }, {
      accounts: [],
      activeJobs: [],
      dockerLastSyncAt: null,
    })).toBe('동기화 필요');
    expect(message({ ...baseComponent, containerName: 'service' }, {
      accounts: [],
      activeJobs: [],
      dockerLastSyncAt: new Date('2026-08-04T00:01:00.000Z'),
    })).toBe('관측되지 않음');
  });
});

describe('ArchitectureComposition responsive layout', () => {
  const source = readFileSync(
    fileURLToPath(new URL('./composition.tsx', import.meta.url)),
    'utf8',
  );

  it('stacks declaration above observation on mobile', () => {
    expect(source).toContain('grid-cols-1');
    expect(source).toContain(
      'md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]',
    );
    expect(source).toContain('md:grid');
    expect(source).toContain('md:hidden');
    expect(source).toContain('break-all');
    expect(source).not.toContain('→');
  });

  it('labels both sides in the stacked layout', () => {
    expect(source).toContain('선언');
    expect(source).toContain('관측');
    expect(source).toContain('<Annotation');
  });
});
