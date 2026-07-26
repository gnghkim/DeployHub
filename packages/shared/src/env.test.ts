import { describe, expect, it } from 'vitest';
import { loadEnv } from './env';

describe('loadEnv', () => {
  it('유효한 환경변수를 파싱한다', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://u:p@localhost:5432/deployhub',
      NODE_ENV: 'test',
      AUTH_SECRET: 's',
      AUTH_GITHUB_ID: 'id',
      AUTH_GITHUB_SECRET: 'secret',
      ENCRYPTION_KEY: 'key',
    });
    expect(env.DATABASE_URL).toBe('postgres://u:p@localhost:5432/deployhub');
    expect(env.NODE_ENV).toBe('test');
  });

  it('DATABASE_URL이 없으면 변수명을 포함해 실패한다', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'test',
        AUTH_SECRET: 's',
        AUTH_GITHUB_ID: 'id',
        AUTH_GITHUB_SECRET: 'secret',
        ENCRYPTION_KEY: 'key',
      }),
    ).toThrow(/DATABASE_URL/);
  });

  it('NODE_ENV가 없으면 development로 기본값을 준다', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://u:p@localhost:5432/d',
      AUTH_SECRET: 's',
      AUTH_GITHUB_ID: 'id',
      AUTH_GITHUB_SECRET: 'secret',
      ENCRYPTION_KEY: 'key',
    });
    expect(env.NODE_ENV).toBe('development');
  });

  it('NODE_ENV 값이 허용 목록 밖이면 실패한다', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgres://u:p@localhost:5432/d',
        NODE_ENV: 'staging',
        AUTH_SECRET: 's',
        AUTH_GITHUB_ID: 'id',
        AUTH_GITHUB_SECRET: 'secret',
        ENCRYPTION_KEY: 'key',
      }),
    ).toThrow(/NODE_ENV/);
  });

  it('AUTH_SECRET이 없으면 변수명을 포함해 실패한다', () => {
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgres://u:p@localhost:5432/d',
        AUTH_GITHUB_ID: 'id',
        AUTH_GITHUB_SECRET: 'secret',
        ENCRYPTION_KEY: 'key',
      }),
    ).toThrow(/AUTH_SECRET/);
  });

  it('ALLOWED_GITHUB_LOGINS가 없어도 로드한다', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://u:p@localhost:5432/d',
      AUTH_SECRET: 's',
      AUTH_GITHUB_ID: 'id',
      AUTH_GITHUB_SECRET: 'secret',
      ENCRYPTION_KEY: 'key',
    });
    expect(env.ALLOWED_GITHUB_LOGINS).toBeUndefined();
  });
});
