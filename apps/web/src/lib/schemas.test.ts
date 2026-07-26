import { describe, expect, it } from 'vitest';
import { projectInputSchema } from './schemas';

const valid = {
  name: 'LinkVault',
  slug: 'linkvault',
  status: 'active',
  lifecycle: 'production',
  importance: 3,
};

describe('projectInputSchema', () => {
  it('유효한 입력을 통과시킨다', () => {
    expect(projectInputSchema.parse(valid)).toMatchObject(valid);
  });

  it('slug 는 소문자·숫자·하이픈만 허용한다', () => {
    expect(() => projectInputSchema.parse({ ...valid, slug: 'Link Vault' })).toThrow();
    expect(() => projectInputSchema.parse({ ...valid, slug: 'link_vault' })).toThrow();
    expect(projectInputSchema.parse({ ...valid, slug: 'link-vault-2' }).slug).toBe('link-vault-2');
  });

  it('repository 는 owner/name 형식만 허용한다', () => {
    expect(projectInputSchema.parse({ ...valid, repository: 'ktgo/workwiki' }).repository).toBe('ktgo/workwiki');
    expect(() => projectInputSchema.parse({ ...valid, repository: 'workwiki' })).toThrow();
    expect(() => projectInputSchema.parse({ ...valid, repository: 'a/b/c' })).toThrow();
  });

  it('status 와 lifecycle 은 허용 목록 밖 값을 거부한다', () => {
    expect(() => projectInputSchema.parse({ ...valid, status: 'zombie' })).toThrow();
    expect(() => projectInputSchema.parse({ ...valid, lifecycle: 'legacy' })).toThrow();
  });

  it('importance 는 1~5 범위만 허용한다', () => {
    expect(() => projectInputSchema.parse({ ...valid, importance: 0 })).toThrow();
    expect(() => projectInputSchema.parse({ ...valid, importance: 6 })).toThrow();
  });

  it('빈 문자열 repository 는 undefined 로 정규화한다', () => {
    expect(projectInputSchema.parse({ ...valid, repository: '' }).repository).toBeUndefined();
  });
});
