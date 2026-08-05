import { describe, expect, it } from 'vitest';
import { moveItem } from './move-item';

describe('moveItem', () => {
  it('항목을 위로 옮긴다', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('항목을 아래로 옮긴다', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  });

  it('제자리로 옮기면 그대로 둔다', () => {
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
  });

  it('목표 위치가 범위를 벗어나면 양 끝으로 붙인다', () => {
    expect(moveItem(['a', 'b', 'c'], 1, -5)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 1, 9)).toEqual(['a', 'c', 'b']);
  });

  it('출발 위치가 범위를 벗어나면 원본 복사본을 돌려준다', () => {
    const items = ['a', 'b', 'c'];

    const result = moveItem(items, 5, 0);

    expect(result).toEqual(items);
    expect(result).not.toBe(items);
  });

  it('원본 배열을 바꾸지 않는다', () => {
    const items = ['a', 'b', 'c'];

    moveItem(items, 0, 2);

    expect(items).toEqual(['a', 'b', 'c']);
  });
});
