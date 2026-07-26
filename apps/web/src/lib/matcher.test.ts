import { describe, expect, it } from 'vitest';
import { suggestMatches } from './matcher';

const repos = [
  { id: 'r1', externalId: 'ktgo/workwiki', name: 'workwiki' },
  { id: 'r2', externalId: 'ktgo/linkvault', name: 'linkvault' },
  { id: 'r3', externalId: 'ktgo/etflow', name: 'etflow' },
];

describe('suggestMatches', () => {
  it('repository 값이 정확히 일치하면 repository 근거로 제안한다', () => {
    const out = suggestMatches(repos, [
      {
        id: 'p1',
        slug: 'workwiki',
        repository: 'ktgo/workwiki',
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      resourceId: 'r1',
      projectId: 'p1',
      basis: 'repository',
    });
  });

  it('repository 가 비었으면 저장소 이름과 slug 일치를 name 근거로 제안한다', () => {
    const out = suggestMatches(repos, [
      { id: 'p2', slug: 'linkvault', repository: null },
    ]);
    expect(out[0]).toMatchObject({
      resourceId: 'r2',
      projectId: 'p2',
      basis: 'name',
    });
  });

  it('repository 가 있으면 이름 일치보다 우선한다', () => {
    const out = suggestMatches(repos, [
      {
        id: 'p3',
        slug: 'workwiki',
        repository: 'ktgo/etflow',
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      resourceId: 'r3',
      basis: 'repository',
    });
  });

  it('대소문자를 구분하지 않는다', () => {
    const out = suggestMatches(repos, [
      { id: 'p4', slug: 'x', repository: 'KTGO/WorkWiki' },
    ]);
    expect(out[0]?.resourceId).toBe('r1');
  });

  it('부분 일치를 제안하지 않는다', () => {
    expect(
      suggestMatches(repos, [
        { id: 'p5', slug: 'work', repository: null },
      ]),
    ).toHaveLength(0);
    expect(
      suggestMatches(repos, [
        { id: 'p6', slug: 'x', repository: 'ktgo/work' },
      ]),
    ).toHaveLength(0);
  });

  it('한 저장소를 여러 프로젝트에 중복 제안하지 않는다', () => {
    const out = suggestMatches(repos, [
      { id: 'p7', slug: 'a', repository: 'ktgo/workwiki' },
      { id: 'p8', slug: 'b', repository: 'ktgo/workwiki' },
    ]);
    expect(out.filter((match) => match.resourceId === 'r1')).toHaveLength(1);
  });

  it('일치가 없으면 빈 배열을 돌려준다', () => {
    expect(
      suggestMatches(repos, [
        { id: 'p9', slug: 'nope', repository: null },
      ]),
    ).toEqual([]);
  });
});
