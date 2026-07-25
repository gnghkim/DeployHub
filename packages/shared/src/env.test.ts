import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

describe('loadEnv', () => {
  it('유효한 환경변수를 파싱한다', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://u:p@localhost:5432/deployhub',
      NODE_ENV: 'test',
    });
    expect(env.DATABASE_URL).toBe('postgres://u:p@localhost:5432/deployhub');
    expect(env.NODE_ENV).toBe('test');
  });

  it('DATABASE_URL이 없으면 변수명을 포함해 실패한다', () => {
    expect(() => loadEnv({ NODE_ENV: 'test' })).toThrow(/DATABASE_URL/);
  });

  it('NODE_ENV가 없으면 development로 기본값을 준다', () => {
    const env = loadEnv({ DATABASE_URL: 'postgres://u:p@localhost:5432/d' });
    expect(env.NODE_ENV).toBe('development');
  });

  it('NODE_ENV 값이 허용 목록 밖이면 실패한다', () => {
    expect(() =>
      loadEnv({ DATABASE_URL: 'postgres://u:p@localhost:5432/d', NODE_ENV: 'staging' }),
    ).toThrow(/NODE_ENV/);
  });
});
