import { asc, eq } from 'drizzle-orm';
import { schema, type Db } from '@deployhub/db';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { startTestDb } from '../../../../packages/db/test/helpers/pg';

const { authMock, dbProxy, dbState } = vi.hoisted(() => {
  const state: { current?: Record<PropertyKey, unknown> } = {};
  return {
    authMock: vi.fn(),
    dbState: state,
    dbProxy: new Proxy({}, {
      get(_target, property) {
        const database = state.current;
        if (!database) throw new Error('test database is not ready');
        const value = database[property];
        return typeof value === 'function' ? value.bind(database) : value;
      },
    }),
  };
});

vi.mock('../auth/config', () => ({ auth: authMock }));
vi.mock('../lib/db', () => ({ db: dbProxy }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import {
  archiveProject,
  createProject,
  reorderProjects,
  updateProject,
} from './projects';

const emptyState = { status: 'idle' as const };

let db: Db;
let stop: () => Promise<void>;

beforeAll(async () => {
  const started = await startTestDb();
  db = started.db;
  stop = started.stop;
  dbState.current = db as unknown as Record<PropertyKey, unknown>;
}, 120_000);

afterAll(async () => {
  await stop();
});

beforeEach(async () => {
  await db.delete(schema.projects);
  authMock.mockReset();
  authMock.mockResolvedValue(null);
});

async function seedProjects(): Promise<string[]> {
  const rows = await db
    .insert(schema.projects)
    .values([
      { name: 'A', slug: 'a', displayOrder: 0 },
      { name: 'B', slug: 'b', displayOrder: 1 },
      { name: 'C', slug: 'c', displayOrder: 2 },
    ])
    .returning({ id: schema.projects.id, slug: schema.projects.slug });
  return ['a', 'b', 'c'].map((slug) => {
    const row = rows.find((candidate) => candidate.slug === slug);
    if (!row) throw new Error(`seed 실패: ${slug}`);
    return row.id;
  });
}

async function currentOrder(): Promise<string[]> {
  const rows = await db
    .select({ slug: schema.projects.slug })
    .from(schema.projects)
    .orderBy(asc(schema.projects.displayOrder), asc(schema.projects.name));
  return rows.map((row) => row.slug);
}

describe('프로젝트 Server Actions 인증', () => {
  it('createProject 는 세션이 없으면 즉시 거부한다', async () => {
    await expect(createProject(emptyState, new FormData())).rejects.toThrow(/인증/);
  });

  it('updateProject 는 세션이 없으면 즉시 거부한다', async () => {
    await expect(updateProject('project-id', emptyState, new FormData())).rejects.toThrow(/인증/);
  });

  it('archiveProject 는 세션이 없으면 즉시 거부한다', async () => {
    await expect(archiveProject('project-id')).rejects.toThrow(/인증/);
  });

  it('reorderProjects 는 세션이 없으면 즉시 거부한다', async () => {
    await expect(reorderProjects([])).rejects.toThrow(/인증/);
  });
});

describe('reorderProjects', () => {
  beforeEach(() => {
    authMock.mockResolvedValue({ user: { name: 'tester' } });
  });

  it('받은 순서대로 0 부터 다시 부여한다', async () => {
    const [a, b, c] = await seedProjects();

    await expect(reorderProjects([c!, a!, b!])).resolves.toEqual({ status: 'success' });
    await expect(currentOrder()).resolves.toEqual(['c', 'a', 'b']);
  });

  it('빠진 프로젝트가 있으면 stale 을 돌려주고 아무 행도 바꾸지 않는다', async () => {
    const [a, b] = await seedProjects();

    await expect(reorderProjects([b!, a!])).resolves.toEqual({ status: 'stale' });
    await expect(currentOrder()).resolves.toEqual(['a', 'b', 'c']);
  });

  it('목록에 없는 id 가 섞이면 stale 을 돌려준다', async () => {
    const [a, b] = await seedProjects();
    const unknown = '00000000-0000-4000-8000-000000000000';

    await expect(reorderProjects([a!, b!, unknown])).resolves.toEqual({ status: 'stale' });
    await expect(currentOrder()).resolves.toEqual(['a', 'b', 'c']);
  });

  it('같은 id 가 중복되면 error 를 돌려준다', async () => {
    const [a, b] = await seedProjects();

    await expect(reorderProjects([a!, b!, a!])).resolves.toEqual({ status: 'error' });
    await expect(currentOrder()).resolves.toEqual(['a', 'b', 'c']);
  });

  it('아카이브된 프로젝트는 순서 대상에서 빠진다', async () => {
    const [a, b, c] = await seedProjects();
    await db
      .update(schema.projects)
      .set({ archivedAt: new Date() })
      .where(eq(schema.projects.id, c!));

    await expect(reorderProjects([b!, a!])).resolves.toEqual({ status: 'success' });
  });
});
