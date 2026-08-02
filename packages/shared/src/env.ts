const NODE_ENVS = ['development', 'production', 'test'] as const;

export type NodeEnv = (typeof NODE_ENVS)[number];

export type Env = {
  DATABASE_URL: string;
  NODE_ENV: NodeEnv;
  AUTH_SECRET: string;
  AUTH_GITHUB_ID: string;
  AUTH_GITHUB_SECRET: string;
  ALLOWED_GITHUB_LOGINS: string | undefined;
  ENCRYPTION_KEY: string;
  DOCKER_HOST_URL: string | undefined;
  SNAPSHOTTER_URL: string | undefined;
};

function requireString(
  source: Record<string, string | undefined>,
  key: string,
): string {
  const value = source[key];
  if (value === undefined || value.trim() === '') {
    throw new Error(`환경변수 ${key}가 설정되지 않았습니다.`);
  }
  return value;
}

export function loadEnv(source: Record<string, string | undefined>): Env {
  const rawNodeEnv = source.NODE_ENV ?? 'development';
  if (!(NODE_ENVS as readonly string[]).includes(rawNodeEnv)) {
    throw new Error(
      `환경변수 NODE_ENV 값이 올바르지 않습니다: ${rawNodeEnv} (허용: ${NODE_ENVS.join(', ')})`,
    );
  }
  return {
    DATABASE_URL: requireString(source, 'DATABASE_URL'),
    NODE_ENV: rawNodeEnv as NodeEnv,
    AUTH_SECRET: requireString(source, 'AUTH_SECRET'),
    AUTH_GITHUB_ID: requireString(source, 'AUTH_GITHUB_ID'),
    AUTH_GITHUB_SECRET: requireString(source, 'AUTH_GITHUB_SECRET'),
    ALLOWED_GITHUB_LOGINS: source.ALLOWED_GITHUB_LOGINS,
    ENCRYPTION_KEY: requireString(source, 'ENCRYPTION_KEY'),
    DOCKER_HOST_URL: source.DOCKER_HOST_URL,
    SNAPSHOTTER_URL: source.SNAPSHOTTER_URL,
  };
}
