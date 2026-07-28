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

  // 원본 계획서 16.3 의 예시 그대로. DeployHub 자신의 선언을 넣으면
  // 'Next.js + Worker' / 'VPS Docker' / 'PostgreSQL' 이 나와야 한다.
  it('renders the DeployHub declaration as the spec example', () => {
    expect(summarizeProject({
      components: [
        component({ type: 'frontend', framework: 'nextjs', runtime: 'nodejs', provider: 'hostinger' }),
        component({ type: 'worker', runtime: 'nodejs', provider: 'hostinger' }),
        component({ type: 'database', runtime: 'postgresql', provider: 'self-hosted' }),
        component({ type: 'monitoring', provider: 'self-hosted' }),
      ],
      observedProviders: ['docker'],
    })).toEqual({
      stack: 'Next.js + Worker',
      deployment: 'VPS Docker',
      database: 'PostgreSQL',
    });
  });

  // worker 는 대개 앱과 같은 runtime 이라 'Node.js' 라고 쓰면 아무것도
  // 더 말해주지 않는다. 역할 이름이 정보다.
  it('prefers the role name over the runtime for worker components', () => {
    expect(summarizeProject({
      components: [component({ type: 'worker', runtime: 'nodejs' })],
      observedProviders: ['docker'],
    }).stack).toBe('Worker');
  });

  // api 는 반대다. 'API' 는 역할을 이미 아는 정보고 무엇으로 만들었는지가 궁금하다.
  it('prefers the runtime over the role name for api components', () => {
    expect(summarizeProject({
      components: [component({ type: 'api', runtime: 'python' })],
      observedProviders: ['docker'],
    }).stack).toBe('Python');
  });

  // self-hosted 는 어디서 돌리는지지 무슨 DB 인지가 아니다. 그건 배포 열이 답한다.
  it('does not put a hosting provider in the database column', () => {
    expect(summarizeProject({
      components: [component({ type: 'database', runtime: 'postgresql', provider: 'self-hosted' })],
      observedProviders: ['docker'],
    }).database).toBe('PostgreSQL');
  });

  // supabase 는 DB 제품이다. 'PostgreSQL' 이라고만 쓰면 어디에 있는지를 잃는다.
  it('keeps a database product name over the engine', () => {
    expect(summarizeProject({
      components: [component({ type: 'database', runtime: 'postgresql', provider: 'supabase' })],
      observedProviders: ['vercel'],
    }).database).toBe('Supabase');
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
