import { describe, expect, it } from 'vitest';
import {
  formatRelativeTime,
  shortContainerId,
  summarizeBackend,
} from './backend-view';

describe('backend summary', () => {
  it.each([
    [['docker'], 'VPS 단독'],
    [['vercel'], 'Vercel'],
    [['docker', 'vercel'], 'Vercel + VPS'],
    [[], '미확인'],
  ] as const)('summarizes observed providers %j', (providers, expected) => {
    expect(summarizeBackend({
      observedProviders: providers,
      declaredProviders: [],
    })).toBe(expected);
  });

  it('keeps an unobserved declaration inside parentheses', () => {
    const summary = summarizeBackend({
      observedProviders: [],
      declaredProviders: ['hostinger'],
    });

    expect(summary).toBe('미확인 (선언: hostinger)');
    expect(summary.slice(0, summary.indexOf('('))).toBe('미확인 ');
  });

  // M4 에서 supabase·hostinger 수집기가 붙는다. 그때 관측을 해 놓고도
  // '미확인' 이라고 쓰면 안 된다. 선언 분기는 관측이 정말 없을 때만이다.
  it('reports observed providers it has no phrase for', () => {
    expect(summarizeBackend({
      observedProviders: ['supabase'],
      declaredProviders: ['hostinger'],
    })).toBe('supabase');
    expect(summarizeBackend({
      observedProviders: ['supabase', 'hostinger'],
      declaredProviders: [],
    })).toBe('hostinger + supabase');
  });

  it('does not let declarations override observed facts', () => {
    expect(summarizeBackend({
      observedProviders: ['docker'],
      declaredProviders: ['vercel', 'hostinger'],
    })).toBe('VPS 단독');
  });
});

describe('backend display helpers', () => {
  it('shortens a container id to 12 characters for display only', () => {
    const id = '3b27fe7ebf9b00000000000000000000000000000000000000000000000000000';

    expect(shortContainerId(id)).toBe('3b27fe7ebf9b');
    expect(id).toHaveLength(65);
  });

  it('formats a static relative time from the supplied server time', () => {
    expect(formatRelativeTime(
      new Date('2026-07-28T01:00:00.000Z'),
      new Date('2026-07-28T03:00:00.000Z'),
    )).toBe('2시간 전');
  });
});
