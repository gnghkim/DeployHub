import { describe, expect, it } from 'vitest';
import { isAllowedLogin } from './allowlist';

describe('isAllowedLogin', () => {
  it('목록에 있는 로그인을 허용한다', () => {
    expect(isAllowedLogin('gnghkim', 'gnghkim,someone')).toBe(true);
  });

  it('목록에 없는 로그인을 거부한다', () => {
    expect(isAllowedLogin('attacker', 'gnghkim,someone')).toBe(false);
  });

  it('대소문자를 구분하지 않는다', () => {
    expect(isAllowedLogin('GnGhKim', 'gnghkim')).toBe(true);
  });

  it('공백을 제거하고 비교한다', () => {
    expect(isAllowedLogin('someone', ' gnghkim , someone ')).toBe(true);
  });

  it('목록이 비어 있으면 전부 거부한다 (fail closed)', () => {
    expect(isAllowedLogin('gnghkim', '')).toBe(false);
  });

  it('목록이 undefined이면 전부 거부한다 (fail closed)', () => {
    expect(isAllowedLogin('gnghkim', undefined)).toBe(false);
  });

  it('빈 로그인은 거부한다', () => {
    expect(isAllowedLogin('', 'gnghkim')).toBe(false);
  });

  it('부분 일치를 허용하지 않는다', () => {
    expect(isAllowedLogin('gnghkim2', 'gnghkim')).toBe(false);
    expect(isAllowedLogin('nghki', 'gnghkim')).toBe(false);
  });
});
