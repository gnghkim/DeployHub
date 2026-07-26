import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestDb } from '../../test/helpers/pg';
import { schema, type Db } from '../index';
import { getProjectBySlug, listProjects } from './projects';

let db: Db;
let stop: () => Promise<void>;

beforeAll(async () => {
  const s = await startTestDb();
  db = s.db;
  stop = s.stop;
}, 120_000);
afterAll(async () => { await stop(); });
beforeEach(async () => { await db.delete(schema.projects); });

describe('프로젝트 조회', () => {
  it('보관되지 않은 프로젝트만 목록에 넣는다', async () => {
    await db.insert(schema.projects).values([
      { name: 'A', slug: 'a' },
      { name: 'B', slug: 'b', archivedAt: new Date() },
    ]);
    const rows = await listProjects(db);
    expect(rows.map((r) => r.slug)).toEqual(['a']);
  });

  it('slug 로 상세를 가져오고 구성요소를 함께 담는다', async () => {
    const [p] = await db.insert(schema.projects).values({ name: 'A', slug: 'a' }).returning();
    if (!p) throw new Error('insert 실패');
    await db.insert(schema.components).values({
      projectId: p.id, name: 'web', slug: 'web', componentType: 'frontend', framework: 'nextjs',
    });

    const detail = await getProjectBySlug(db, 'a');
    expect(detail?.name).toBe('A');
    expect(detail?.components).toHaveLength(1);
    expect(detail?.components[0]?.framework).toBe('nextjs');
  });

  it('없는 slug 는 undefined 를 돌려준다', async () => {
    expect(await getProjectBySlug(db, 'nope')).toBeUndefined();
  });

  it('repository 값을 저장하고 돌려준다', async () => {
    await db.insert(schema.projects).values({ name: 'A', slug: 'a', repository: 'ktgo/a' });
    const detail = await getProjectBySlug(db, 'a');
    expect(detail?.repository).toBe('ktgo/a');
  });
});
