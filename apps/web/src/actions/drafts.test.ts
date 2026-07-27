import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  insertDraft,
  schema,
  type Db,
} from '@deployhub/db';
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

const { authMock, dbProxy, dbState, revalidatePathMock } = vi.hoisted(() => {
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
    revalidatePathMock: vi.fn(),
  };
});

vi.mock('../auth/config', () => ({ auth: authMock }));
vi.mock('../lib/db', () => ({ db: dbProxy }));
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock }));

import { approveDraft, rejectDraft } from './drafts';

const MANIFEST = `apiVersion: deployhub.io/v1
kind: Project
metadata:
  name: DeployHub
  slug: deployhub
  description: Approved description
spec:
  lifecycle: production
  importance: 5
  owner: platform
  repository:
    provider: github
    slug: ktgo/deployhub
  components:
    - name: web
      type: frontend
      framework: nextjs
      runtime: nodejs
      language: typescript
      criticality: 4
      provider: hostinger
      externalRef: deployhub-web-service
      container: deployhub-web
      url: https://hub.nolzza.net
    - name: worker
      type: worker
      runtime: nodejs
  domains:
    - domain: hub.example.com
      environment: production
`;

let db: Db;
let stop: () => Promise<void>;
let reviewerId: string;

beforeAll(async () => {
  const started = await startTestDb();
  db = started.db;
  dbState.current = db as unknown as Record<PropertyKey, unknown>;
  stop = started.stop;
}, 120_000);

afterAll(async () => {
  await stop();
});

beforeEach(async () => {
  await db.delete(schema.projectDrafts);
  await db.delete(schema.domains);
  await db.delete(schema.components);
  await db.delete(schema.projects);
  await db.delete(schema.registrationTokens);
  await db.delete(schema.users);

  const [reviewer] = await db
    .insert(schema.users)
    .values({
      githubId: BigInt(Date.now()),
      githubLogin: `reviewer-${Date.now()}`,
    })
    .returning();
  if (!reviewer) throw new Error('reviewer insert failed');
  reviewerId = reviewer.id;

  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: reviewerId } });
  revalidatePathMock.mockReset();
});

async function pendingDraft(
  overrides: Partial<typeof schema.projectDrafts.$inferInsert> = {},
) {
  return insertDraft(db, {
    projectId: null,
    manifestVersion: 'deployhub.io/v1',
    manifestYaml: MANIFEST,
    fieldSources: {
      web: {
        framework: {
          origin: 'detected',
          evidence: 'next@16.2.12',
        },
      },
    },
    sourceType: 'cli',
    submittedByType: 'token',
    submittedById: randomUUID(),
    status: 'pending_review',
    validationResult: { ok: true, warnings: [] },
    diff: {},
    ...overrides,
  });
}

describe('approveDraft', () => {
  it('rejects approval without a session before changing the Draft', async () => {
    const draft = await pendingDraft();
    authMock.mockResolvedValue(null);

    await expect(approveDraft(draft.id)).rejects.toThrow(/인증/);

    expect((await db
      .select()
      .from(schema.projectDrafts)
      .where(eq(schema.projectDrafts.id, draft.id)))[0]?.status).toBe(
      'pending_review',
    );
  });

  it('creates a new project, components, and domains in one approval', async () => {
    const draft = await pendingDraft();

    await approveDraft(draft.id);

    const [project] = await db.select().from(schema.projects);
    expect(project).toMatchObject({
      name: 'DeployHub',
      slug: 'deployhub',
      status: 'active',
      lifecycle: 'production',
      importance: 5,
      owner: 'platform',
      repository: 'ktgo/deployhub',
    });
    expect((await db.select().from(schema.components)).map(
      ({
        name,
        provider,
        externalRef,
        containerName,
        url,
      }) => ({
        name,
        provider,
        externalRef,
        containerName,
        url,
      }),
    )).toEqual([
      {
        name: 'web',
        provider: 'hostinger',
        externalRef: 'deployhub-web-service',
        containerName: 'deployhub-web',
        url: 'https://hub.nolzza.net',
      },
      {
        name: 'worker',
        provider: null,
        externalRef: null,
        containerName: null,
        url: null,
      },
    ]);
    expect(await db.select().from(schema.domains)).toMatchObject([
      {
        projectId: project?.id,
        domain: 'hub.example.com',
        environment: 'production',
      },
    ]);
  });

  it('updates an existing project and its declared components', async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({
        name: 'Old DeployHub',
        slug: 'deployhub',
        lifecycle: 'development',
      })
      .returning();
    if (!project) throw new Error('project insert failed');
    await db.insert(schema.components).values({
      projectId: project.id,
      name: 'web',
      slug: 'web',
      componentType: 'backend',
      framework: 'express',
    });
    const draft = await pendingDraft({ projectId: project.id });

    await approveDraft(draft.id);

    const [updatedProject] = await db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, project.id));
    const [updatedWeb] = await db
      .select()
      .from(schema.components)
      .where(eq(schema.components.slug, 'web'));
    expect(updatedProject).toMatchObject({
      name: 'DeployHub',
      lifecycle: 'production',
      importance: 5,
    });
    expect(updatedWeb).toMatchObject({
      componentType: 'frontend',
      framework: 'nextjs',
      runtime: 'nodejs',
      language: 'typescript',
      criticality: 4,
      provider: 'hostinger',
      externalRef: 'deployhub-web-service',
      containerName: 'deployhub-web',
      url: 'https://hub.nolzza.net',
    });
  });

  it('does not automatically delete components missing from the manifest', async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({ name: 'DeployHub', slug: 'deployhub' })
      .returning();
    if (!project) throw new Error('project insert failed');
    await db.insert(schema.components).values([
      {
        projectId: project.id,
        name: 'web',
        slug: 'web',
        componentType: 'frontend',
      },
      {
        projectId: project.id,
        name: 'legacy-api',
        slug: 'legacy-api',
        componentType: 'api',
      },
    ]);
    const draft = await pendingDraft({ projectId: project.id });

    await approveDraft(draft.id);

    expect((await db.select().from(schema.components)).map(
      ({ name }) => name,
    )).toContain('legacy-api');
  });

  it('does not allow an approved Draft to be approved again', async () => {
    const draft = await pendingDraft();
    await approveDraft(draft.id);

    await expect(approveDraft(draft.id)).rejects.toThrow(/승인할 수 없는/);

    const [stored] = await db
      .select()
      .from(schema.projectDrafts)
      .where(eq(schema.projectDrafts.id, draft.id));
    expect(stored).toMatchObject({
      status: 'approved',
      reviewedBy: reviewerId,
    });
  });
});

describe('rejectDraft', () => {
  it('marks a pending Draft rejected with review metadata', async () => {
    const draft = await pendingDraft();

    await rejectDraft(draft.id);

    const [stored] = await db
      .select()
      .from(schema.projectDrafts)
      .where(eq(schema.projectDrafts.id, draft.id));
    expect(stored).toMatchObject({
      status: 'rejected',
      reviewedBy: reviewerId,
    });
  });
});
