import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  buildComposition,
  type CompositionInput,
} from './composition-model';

function input(
  overrides: Partial<CompositionInput> = {},
): CompositionInput {
  return {
    components: [],
    resources: [],
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
        containerName: 'deployhub-worker',
      }],
    }));

    expect(composition.rows[0]).toMatchObject({
      declaration: {
        name: 'worker',
        technology: 'Node',
      },
      observations: [{
        name: '관측되지 않음',
        provider: null,
        status: null,
        missing: true,
      }],
    });
    expect(composition.rows[0]?.observations).not.toContainEqual(
      expect.objectContaining({ name: 'deployhub-worker' }),
    );
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
        containerName: 'deployhub-postgres',
      },
      {
        id: 'worker',
        name: 'worker',
        componentType: 'worker',
        framework: null,
        runtime: 'nodejs',
        language: 'typescript',
        provider: 'hostinger',
        containerName: 'deployhub-worker',
      },
      {
        id: 'web',
        name: 'web',
        componentType: 'frontend',
        framework: 'nextjs',
        runtime: 'nodejs',
        language: 'typescript',
        provider: 'hostinger',
        containerName: 'deployhub-web',
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
        containerName: 'declared-web',
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
        missing: false,
      }],
    });
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
        containerName: 'deployhub-web',
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
        name: '관측되지 않음',
        missing: true,
      }),
    ]);
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
      'md:grid-cols-[minmax(0,1fr)_2rem_minmax(0,1fr)]',
    );
    expect(source).toContain('md:grid');
    expect(source).toContain('md:hidden');
  });

  it('labels both sides in the stacked layout', () => {
    expect(source).toContain('선언');
    expect(source).toContain('관측');
    expect(source).toContain('{observation.name}');
  });
});
