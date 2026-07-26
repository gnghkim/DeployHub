import { describe, expect, it } from 'vitest';
import { componentInputSchema, projectInputSchema } from './schemas';

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

  it('문자열 필드의 앞뒤 공백을 제거한다', () => {
    const parsed = projectInputSchema.parse({
      ...valid,
      name: '  LinkVault  ',
      description: '  링크 저장소  ',
      owner: '  platform-team  ',
      repository: '  ktgo/workwiki  ',
    });

    expect(parsed).toMatchObject({
      name: 'LinkVault',
      description: '링크 저장소',
      owner: 'platform-team',
      repository: 'ktgo/workwiki',
    });
  });

  it('공백만 있는 name 을 거부한다', () => {
    expect(() => projectInputSchema.parse({ ...valid, name: '   ' })).toThrow();
  });

  it('repository 공백을 제거한 뒤 owner/name 형식을 검사한다', () => {
    expect(
      projectInputSchema.parse({ ...valid, repository: '  ktgo/workwiki  ' }).repository,
    ).toBe('ktgo/workwiki');
  });
});

describe('componentInputSchema', () => {
  const valid = { name: 'web', slug: 'web', componentType: 'frontend', criticality: 3 };

  it('유효한 입력을 통과시킨다', () => {
    expect(componentInputSchema.parse(valid)).toMatchObject(valid);
  });

  it('component_type 은 스키마 enum 11종만 허용한다', () => {
    expect(() => componentInputSchema.parse({ ...valid, componentType: 'gateway' })).toThrow();
    expect(componentInputSchema.parse({ ...valid, componentType: 'worker' }).componentType).toBe('worker');
  });

  it('framework·runtime·language 는 선택이며 빈 문자열은 undefined 가 된다', () => {
    const parsed = componentInputSchema.parse({ ...valid, framework: '', runtime: 'nodejs' });
    expect(parsed.framework).toBeUndefined();
    expect(parsed.runtime).toBe('nodejs');
  });

  it('문자열 필드의 앞뒤 공백을 제거하고 공백뿐인 선택값은 undefined 로 만든다', () => {
    const parsed = componentInputSchema.parse({
      ...valid,
      name: '  web  ',
      framework: '  Next.js  ',
      runtime: '   ',
      language: '  TypeScript  ',
    });

    expect(parsed).toMatchObject({
      name: 'web',
      framework: 'Next.js',
      language: 'TypeScript',
    });
    expect(parsed.runtime).toBeUndefined();
  });

  it('공백만 있는 name 을 거부한다', () => {
    expect(() => componentInputSchema.parse({ ...valid, name: '   ' })).toThrow();
  });
});
