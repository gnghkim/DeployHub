import { describe, expect, it } from 'vitest';
import { summarizeProject, type ProjectSummaryInput } from './project-summary';

const component = (
  overrides: Partial<ProjectSummaryInput['components'][number]>,
): ProjectSummaryInput['components'][number] => ({
  type: 'frontend',
  framework: null,
  runtime: null,
  provider: null,
  ...overrides,
});

describe('summarizeProject', () => {
  it.each([
    [
      [
        component({ type: 'frontend', framework: 'nextjs' }),
        component({ type: 'worker' }),
      ],
      'Next.js + Worker',
    ],
    [[component({ type: 'frontend', framework: 'nextjs' })], 'Next.js'],
    [
      [
        component({ type: 'frontend', framework: 'nextjs' }),
        component({ type: 'api', runtime: 'python' }),
      ],
      'Next.js + Python',
    ],
    [[], '—'],
  ])('builds the stack from components', (components, expected) => {
    expect(summarizeProject({
      components,
      observedProviders: [],
    }).stack).toBe(expected);
  });

  it('excludes database components from the stack', () => {
    expect(summarizeProject({
      components: [
        component({ type: 'frontend', framework: 'nextjs' }),
        component({ type: 'database', runtime: 'postgresql' }),
      ],
      observedProviders: [],
    }).stack).toBe('Next.js');
  });

  it('deduplicates and sorts the stack independently of component order', () => {
    const components = [
      component({ type: 'worker' }),
      component({ type: 'frontend', framework: 'nextjs' }),
      component({ type: 'frontend', framework: 'nextjs' }),
    ];

    const forward = summarizeProject({
      components,
      observedProviders: [],
    });
    const reversed = summarizeProject({
      components: [...components].reverse(),
      observedProviders: [],
    });

    expect(forward.stack).toBe('Next.js + Worker');
    expect(reversed.stack).toBe(forward.stack);
  });

  it.each([
    ['nextjs', 'Next.js'],
    ['react', 'React'],
    ['fastapi', 'FastAPI'],
    ['express', 'Express'],
    ['nuxtjs', 'nuxtjs'],
  ])('maps framework %s to %s without inventing unknown names', (framework, expected) => {
    expect(summarizeProject({
      components: [component({ framework })],
      observedProviders: [],
    }).stack).toBe(expected);
  });

  it.each([
    [['docker'], 'VPS Docker'],
    [['vercel'], 'Vercel'],
    [['docker', 'vercel'], 'Vercel + VPS'],
    [[], '미확인'],
  ])('summarizes observed deployment providers %j', (observedProviders, expected) => {
    expect(summarizeProject({
      components: [],
      observedProviders,
    }).deployment).toBe(expected);
  });

  it('uses declarations only when no deployment provider was observed', () => {
    expect(summarizeProject({
      components: [component({ provider: 'hostinger' })],
      observedProviders: [],
    }).deployment).toBe('미확인 (선언: hostinger)');

    expect(summarizeProject({
      components: [component({ provider: 'hostinger' })],
      observedProviders: ['docker'],
    }).deployment).toBe('VPS Docker');
  });

  it.each([
    [
      component({ type: 'database', provider: 'supabase', runtime: 'postgresql' }),
      'Supabase',
    ],
    [component({ type: 'database', runtime: 'postgresql' }), 'PostgreSQL'],
    [component({ type: 'database' }), '—'],
  ])('summarizes a database component', (database, expected) => {
    expect(summarizeProject({
      components: [database],
      observedProviders: [],
    }).database).toBe(expected);
  });
});
