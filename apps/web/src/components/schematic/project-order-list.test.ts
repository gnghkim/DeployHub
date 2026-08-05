import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = (relativePath: string) => readFileSync(
  fileURLToPath(new URL(relativePath, import.meta.url)),
  'utf8',
);

const LIST = source('./project-order-list.tsx');

describe('project order list', () => {
  it('클라이언트 컴포넌트로 목록을 소유한다', () => {
    expect(LIST).toContain("'use client'");
    expect(LIST).toContain('<ul ref={listRef} className="space-y-4">');
  });

  it('핸들에서만 드래그를 시작하고 스크롤에 먹히지 않게 한다', () => {
    expect(LIST).toContain('onPointerDown');
    expect(LIST).toContain('setPointerCapture');
    expect(LIST).toContain('touch-none');
  });

  it('놓는 순간 서버 액션으로 저장하고 실패하면 서버 상태로 되돌린다', () => {
    expect(LIST).toContain('reorderProjects');
    expect(LIST).toContain('router.refresh()');
  });

  it('키보드로도 같은 저장 경로를 쓴다', () => {
    expect(LIST).toContain("case 'ArrowUp'");
    expect(LIST).toContain("case 'ArrowDown'");
    expect(LIST).toContain('event.preventDefault()');
  });

  it('이동 결과를 스크린 리더에 알린다', () => {
    expect(LIST).toContain('aria-label={`${item.name} 순서 이동`}');
    expect(LIST).toContain('aria-live="polite"');
    expect(LIST).toContain('번째');
  });

  it('재배치 계산을 순수 함수에 맡긴다', () => {
    expect(LIST).toContain("from '../../lib/move-item'");
    expect(LIST).toContain('moveItem(');
  });
});
