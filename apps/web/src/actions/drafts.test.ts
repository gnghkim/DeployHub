import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
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

import {
  approveDraft,
  enqueueApprovedDraftRefreshes,
  rejectDraft,
} from './drafts';

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
      healthUrl: https://hub.nolzza.net/api/health/ready
    - name: worker
      type: worker
      runtime: nodejs
  domains:
    - domain: hub.example.com
      environment: production
`;

const RECONCILIATION_MANIFEST = `apiVersion: deployhub.io/v1
kind: Project
metadata:
  name: LinkVault
  slug: linkvault
spec:
  lifecycle: production
  components:
    - name: web
      type: frontend
      provider: vercel
      externalRef: prj_linkvault
    - name: worker
      type: worker
      provider: hostinger
      container: linkvault-worker
    - name: database
      type: database
      provider: supabase
      externalRef: supabase-linkvault
    - name: authentication
      type: authentication
      provider: supabase
      externalRef: supabase-linkvault
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
  await db.delete(schema.componentResources);
  await db.delete(schema.resources);
  await db.delete(schema.providerAccounts);
  await db.delete(schema.jobs);
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
        healthUrl,
      }) => ({
        name,
        provider,
        externalRef,
        containerName,
        url,
        healthUrl,
      }),
    )).toEqual([
      {
        name: 'web',
        provider: 'hostinger',
        externalRef: 'deployhub-web-service',
        containerName: 'deployhub-web',
        url: 'https://hub.nolzza.net',
        healthUrl: 'https://hub.nolzza.net/api/health/ready',
      },
      {
        name: 'worker',
        provider: null,
        externalRef: null,
        containerName: null,
        url: null,
        healthUrl: null,
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

  it('updates an existing project and clears an omitted health URL', async () => {
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
      healthUrl: 'https://old.example.com/health',
    });
    const draft = await pendingDraft({
      projectId: project.id,
      manifestYaml: MANIFEST.replace(
        '      healthUrl: https://hub.nolzza.net/api/health/ready\n',
        '',
      ),
    });

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
      healthUrl: null,
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

  it('reconciles declared resources, preserves user links, and queues refreshes', async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({ name: 'LinkVault', slug: 'linkvault' })
      .returning();
    if (!project) throw new Error('project insert failed');
    const components = await db
      .insert(schema.components)
      .values([
        { projectId: project.id, name: 'web', slug: 'web', componentType: 'frontend' },
        { projectId: project.id, name: 'worker', slug: 'worker', componentType: 'worker' },
        { projectId: project.id, name: 'database', slug: 'database', componentType: 'database' },
        { projectId: project.id, name: 'authentication', slug: 'authentication', componentType: 'authentication' },
        { projectId: project.id, name: 'legacy-api', slug: 'legacy-api', componentType: 'api' },
      ])
      .returning();
    const componentByName = new Map(
      components.map((component) => [component.name, component]),
    );
    const resources = await db
      .insert(schema.resources)
      .values([
        { provider: 'vercel', externalId: 'prj_linkvault', resourceType: 'vercel_project', name: 'linkvault' },
        { provider: 'docker', externalId: 'container-worker', resourceType: 'docker_container', name: 'linkvault-worker' },
        { provider: 'supabase', externalId: 'supabase-linkvault', resourceType: 'supabase_project', name: 'LinkVault' },
        { provider: 'docker', externalId: 'stale-manifest', resourceType: 'docker_container', name: 'old-manifest' },
        { provider: 'docker', externalId: 'stale-label', resourceType: 'docker_container', name: 'old-label' },
        { provider: 'vercel', externalId: 'manual-vercel', resourceType: 'vercel_project', name: 'manual' },
      ])
      .returning();
    const resourceByExternalId = new Map(
      resources.map((resource) => [resource.externalId, resource]),
    );
    const legacy = componentByName.get('legacy-api');
    const manualResource = resourceByExternalId.get('manual-vercel');
    if (!legacy || !manualResource) throw new Error('link fixture missing');
    await db.insert(schema.componentResources).values([
      {
        componentId: legacy.id,
        resourceId: resourceByExternalId.get('stale-manifest')!.id,
        relationType: 'deployed_to',
        linkedBy: 'manifest',
      },
      {
        componentId: legacy.id,
        resourceId: resourceByExternalId.get('stale-label')!.id,
        relationType: 'deployed_to',
        linkedBy: 'label',
      },
      {
        componentId: legacy.id,
        resourceId: manualResource.id,
        relationType: 'deployed_to',
        linkedBy: 'user',
      },
    ]);
    const [userLinkBefore] = await db
      .select()
      .from(schema.componentResources)
      .where(eq(schema.componentResources.resourceId, manualResource.id));
    await db.insert(schema.providerAccounts).values([
      { provider: 'vercel', name: 'team', encryptedToken: 'encrypted-vercel' },
      { provider: 'supabase', name: 'supabase', encryptedToken: 'encrypted-supabase' },
    ]);
    const draft = await pendingDraft({
      projectId: project.id,
      manifestYaml: RECONCILIATION_MANIFEST,
    });

    await approveDraft(draft.id);

    const links = await db
      .select({
        id: schema.componentResources.id,
        componentId: schema.componentResources.componentId,
        componentName: schema.components.name,
        provider: schema.resources.provider,
        externalId: schema.resources.externalId,
        linkedBy: schema.componentResources.linkedBy,
      })
      .from(schema.componentResources)
      .innerJoin(
        schema.components,
        eq(schema.components.id, schema.componentResources.componentId),
      )
      .innerJoin(
        schema.resources,
        eq(schema.resources.id, schema.componentResources.resourceId),
      );
    expect(links).toEqual(expect.arrayContaining([
      expect.objectContaining({ componentName: 'web', provider: 'vercel', linkedBy: 'manifest' }),
      expect.objectContaining({ componentName: 'worker', provider: 'docker', linkedBy: 'manifest' }),
      expect.objectContaining({ componentName: 'database', provider: 'supabase', linkedBy: 'manifest' }),
      expect.objectContaining({ componentName: 'authentication', provider: 'supabase', linkedBy: 'manifest' }),
    ]));
    expect(links).not.toContainEqual(
      expect.objectContaining({ externalId: 'stale-manifest' }),
    );
    expect(links).not.toContainEqual(
      expect.objectContaining({ externalId: 'stale-label' }),
    );
    expect(links).toContainEqual(expect.objectContaining({
      id: userLinkBefore?.id,
      componentId: legacy.id,
      externalId: 'manual-vercel',
      linkedBy: 'user',
    }));

    const jobs = await db
      .select({
        type: schema.jobs.type,
        dedupeKey: schema.jobs.dedupeKey,
        status: schema.jobs.status,
      })
      .from(schema.jobs)
      .orderBy(asc(schema.jobs.type));
    expect(jobs).toEqual([
      { type: 'docker.sync', dedupeKey: 'docker:global', status: 'pending' },
      { type: 'supabase.sync', dedupeKey: expect.stringMatching(/^supabase:/), status: 'pending' },
      { type: 'vercel.sync', dedupeKey: expect.stringMatching(/^vercel:/), status: 'pending' },
    ]);
    expect(revalidatePathMock).toHaveBeenCalledWith('/projects/linkvault');
    expect(revalidatePathMock).toHaveBeenCalledWith('/settings/providers');
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

describe('enqueueApprovedDraftRefreshes', () => {
  it('keeps approval successful and logs only safe job metadata on enqueue failure', async () => {
    const enqueueRefresh = vi
      .fn()
      .mockRejectedValue(new Error('provider-secret'));
    const logError = vi.fn();

    await expect(enqueueApprovedDraftRefreshes({
      accounts: [{ id: 'account-1', provider: 'supabase' }],
      docker: true,
    }, enqueueRefresh, logError)).resolves.toBeUndefined();

    expect(enqueueRefresh).toHaveBeenCalledTimes(2);
    expect(logError).toHaveBeenCalledWith(
      '[draft] supabase.sync refresh job 등록 실패',
    );
    expect(logError).toHaveBeenCalledWith(
      '[draft] docker.sync refresh job 등록 실패',
    );
    expect(JSON.stringify(logError.mock.calls)).not.toContain(
      'provider-secret',
    );
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
