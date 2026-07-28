import { summarizeBackend } from './backend-view';

export type ProjectSummaryInput = {
  components: Array<{
    type: string;
    framework: string | null;
    runtime: string | null;
    provider: string | null;
  }>;
  observedProviders: string[];
};

export type ProjectSummary = {
  stack: string;
  deployment: string;
  database: string;
};

const FRAMEWORK_NAMES: Record<string, string> = {
  nextjs: 'Next.js',
  react: 'React',
  fastapi: 'FastAPI',
  express: 'Express',
};

const RUNTIME_NAMES: Record<string, string> = {
  nodejs: 'Node.js',
  python: 'Python',
  postgresql: 'PostgreSQL',
};

const TYPE_NAMES: Record<string, string> = {
  frontend: 'Frontend',
  backend: 'Backend',
  api: 'API',
  worker: 'Worker',
  scheduler: 'Scheduler',
  authentication: 'Authentication',
  storage: 'Storage',
  cache: 'Cache',
  queue: 'Queue',
  monitoring: 'Monitoring',
};

// provider 는 두 종류가 섞여 있다. supabase·neon 처럼 DB 제품인 것과
// self-hosted·hostinger 처럼 어디서 돌리는지만 말하는 것이다. 후자를
// DB 열에 쓰면 'self-hosted' 라고 적히는데, 그건 이미 배포 열이 답한
// 것이고 무슨 DB 인지는 여전히 알 수 없다.
const DATABASE_PRODUCT_NAMES: Record<string, string> = {
  supabase: 'Supabase',
  neon: 'Neon',
  planetscale: 'PlanetScale',
  upstash: 'Upstash',
};

// 이 타입들은 무엇으로 만들었는지(runtime)가 역할 이름보다 정보가 많다.
// worker 는 반대다 — 대개 앱과 같은 runtime 이라 'Node.js' 라고 쓰면
// 아무것도 더 말해주지 않는다. 'Worker' 가 역할을 말한다.
const RUNTIME_FIRST_TYPES = new Set(['api', 'backend']);

// 한 줄 요약에서 뺀다. database 는 전용 열이 있고, monitoring 은
// 앱 구성이 아니라 곁다리다. 전체 목록은 상세 화면이 보여준다.
const EXCLUDED_FROM_STACK = new Set(['database', 'monitoring']);

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'));
}

function runtimeName(runtime: string): string {
  return RUNTIME_NAMES[runtime] ?? runtime;
}

function typeName(type: string): string {
  return TYPE_NAMES[type] ?? type;
}

function stackName(component: ProjectSummaryInput['components'][number]): string {
  if (component.framework) {
    return FRAMEWORK_NAMES[component.framework] ?? component.framework;
  }
  if (RUNTIME_FIRST_TYPES.has(component.type) && component.runtime) {
    return runtimeName(component.runtime);
  }
  const role = TYPE_NAMES[component.type];
  if (role !== undefined) return role;
  return component.runtime ? runtimeName(component.runtime) : typeName(component.type);
}

function databaseName(component: ProjectSummaryInput['components'][number]): string | null {
  // DB 제품이 선언돼 있으면 그것이 답이다. Supabase 위의 postgres 를
  // 'PostgreSQL' 이라고만 쓰면 어디에 있는지를 잃는다.
  const product = component.provider
    ? DATABASE_PRODUCT_NAMES[component.provider]
    : undefined;
  if (product) return product;
  if (component.runtime) return runtimeName(component.runtime);
  return null;
}

export function summarizeProject({
  components,
  observedProviders,
}: ProjectSummaryInput): ProjectSummary {
  const stack = uniqueSorted(
    components
      .filter((component) => !EXCLUDED_FROM_STACK.has(component.type))
      .map(stackName),
  );
  const databases = uniqueSorted(
    components
      .filter((component) => component.type === 'database')
      .flatMap((component) => {
        const name = databaseName(component);
        return name ? [name] : [];
      }),
  );

  return {
    stack: stack.length > 0 ? stack.join(' + ') : '—',
    deployment: summarizeBackend({
      observedProviders,
      declaredProviders: components.map((component) => component.provider),
    }),
    database: databases.length > 0 ? databases.join(' + ') : '—',
  };
}
