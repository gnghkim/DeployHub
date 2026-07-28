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

const DATABASE_PROVIDER_NAMES: Record<string, string> = {
  supabase: 'Supabase',
};

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, 'en'));
}

function stackName(component: ProjectSummaryInput['components'][number]): string {
  if (component.framework) {
    return FRAMEWORK_NAMES[component.framework] ?? component.framework;
  }
  if (component.runtime) {
    return RUNTIME_NAMES[component.runtime] ?? component.runtime;
  }
  return TYPE_NAMES[component.type] ?? component.type;
}

function databaseName(component: ProjectSummaryInput['components'][number]): string | null {
  if (component.provider) {
    return DATABASE_PROVIDER_NAMES[component.provider] ?? component.provider;
  }
  if (component.runtime) {
    return RUNTIME_NAMES[component.runtime] ?? component.runtime;
  }
  return null;
}

export function summarizeProject({
  components,
  observedProviders,
}: ProjectSummaryInput): ProjectSummary {
  const stack = uniqueSorted(
    components
      .filter((component) => component.type !== 'database')
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
