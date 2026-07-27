import {
  consumeToken,
  issueToken,
  schema,
  type Db,
} from '@deployhub/db';
import { MANIFEST_VERSION } from '@deployhub/manifest';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { startTestDb } from '../../../../../../../../packages/db/test/helpers/pg';
import {
  getCurrentProject,
  getProjectStatus,
} from '../../../../../../../../packages/cli/src/api';
import { createProjectManifestHandler } from './manifest/route';
import { createProjectStatusHandler } from './status/route';

let db: Db;
let stop: () => Promise<void>;
let createdBy: string;

beforeAll(async () => {
  const started = await startTestDb();
  db = started.db;
  stop = started.stop;
}, 120_000);

afterAll(async () => {
  await stop();
});

beforeEach(async () => {
  await db.delete(schema.projectDrafts);
  await db.delete(schema.registrationTokens);
  await db.delete(schema.componentResources);
  await db.delete(schema.resources);
  await db.delete(schema.providerAccounts);
  await db.delete(schema.domains);
  await db.delete(schema.components);
  await db.delete(schema.projects);
  await db.delete(schema.users);

  const [user] = await db
    .insert(schema.users)
    .values({
      githubId: BigInt(Date.now()),
      githubLogin: `read-api-issuer-${Date.now()}`,
    })
    .returning();
  if (!user) throw new Error('user insert failed');
  createdBy = user.id;
});

const issue = (
  overrides: Partial<Parameters<typeof issueToken>[1]> = {},
) => issueToken(db, {
  scope: 'project:draft:create',
  expiresAt: new Date(Date.now() + 60_000),
  createdBy,
  ...overrides,
});

const context = (slug: string) => ({
  params: Promise.resolve({ slug }),
});

const request = (
  path: 'manifest' | 'status',
  token?: string,
  slug = 'deployhub',
  query = '',
): Request => {
  const headers = new Headers({ Accept: 'application/json' });
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return new Request(
    `http://localhost/api/v1/projects/${slug}/${path}${query}`,
    { headers },
  );
};

async function seedProject() {
  const [project] = await db
    .insert(schema.projects)
    .values({
      name: 'DeployHub',
      slug: 'deployhub',
      description: 'Deployment inventory',
      status: 'active',
      lifecycle: 'production',
      importance: 5,
      owner: 'platform',
      repository: 'ktgo/deployhub',
    })
    .returning();
  if (!project) throw new Error('project insert failed');
  const components = await db
    .insert(schema.components)
    .values([
      {
        projectId: project.id,
        name: 'Web',
        slug: 'web',
        componentType: 'frontend',
        framework: 'nextjs',
        runtime: 'node',
        language: 'typescript',
        criticality: 5,
        provider: 'hostinger',
        externalRef: 'deployhub-web-service',
        containerName: 'deployhub-web',
        url: 'https://hub.nolzza.net',
      },
      {
        projectId: project.id,
        name: 'Worker',
        slug: 'worker',
        componentType: 'worker',
        runtime: 'node',
        language: 'typescript',
        criticality: 4,
      },
    ])
    .returning();
  const [web, worker] = components;
  if (!web || !worker) throw new Error('component insert failed');
  await db.insert(schema.domains).values({
    projectId: project.id,
    componentId: web.id,
    domain: 'deployhub.example.com',
    environment: 'production',
  });

  const encryptedToken = 'encrypted-token-must-not-leak';
  const [provider] = await db
    .insert(schema.providerAccounts)
    .values({
      provider: 'github',
      name: 'production',
      encryptedToken,
    })
    .returning();
  if (!provider) throw new Error('provider insert failed');
  const resources = await db
    .insert(schema.resources)
    .values([
      {
        provider: 'github',
        providerAccountId: provider.id,
        externalId: 'repo-1',
        resourceType: 'github_repository',
        name: 'DeployHub repository',
      },
      {
        provider: 'github',
        providerAccountId: provider.id,
        externalId: 'repo-unlinked',
        resourceType: 'github_repository',
        name: 'Unlinked repository',
      },
    ])
    .returning();
  const [linkedResource] = resources;
  if (!linkedResource) throw new Error('resource insert failed');
  await db.insert(schema.componentResources).values([
    {
      componentId: web.id,
      resourceId: linkedResource.id,
      relationType: 'uses',
      linkedBy: 'user',
    },
    {
      componentId: worker.id,
      resourceId: linkedResource.id,
      relationType: 'uses',
      linkedBy: 'manifest',
    },
  ]);

  const olderCreatedAt = new Date('2026-07-26T01:00:00.000Z');
  const latestCreatedAt = new Date('2026-07-26T02:00:00.000Z');
  await db.insert(schema.projectDrafts).values([
    {
      projectId: project.id,
      manifestVersion: MANIFEST_VERSION,
      manifestYaml: 'older',
      sourceType: 'cli',
      submittedByType: 'token',
      submittedById: project.id,
      status: 'approved',
      createdAt: olderCreatedAt,
    },
    {
      projectId: project.id,
      manifestVersion: MANIFEST_VERSION,
      manifestYaml: 'latest',
      sourceType: 'cli',
      submittedByType: 'token',
      submittedById: project.id,
      status: 'pending_review',
      createdAt: latestCreatedAt,
    },
  ]);

  return {
    project,
    encryptedToken,
    latestCreatedAt,
  };
}

describe('GET project read APIs', () => {
  it.each(['manifest', 'status'] as const)(
    'returns 401 before any database lookup for %s without a Bearer token',
    async (path) => {
      const noDatabase = new Proxy({} as Db, {
        get() {
          throw new Error('database must not be queried');
        },
      });
      const handler = path === 'manifest'
        ? createProjectManifestHandler(noDatabase)
        : createProjectStatusHandler(noDatabase);

      const response = await handler(
        request(path, undefined, 'deployhub', '?token=dh_reg_forbidden'),
        context('deployhub'),
      );

      expect(response.status).toBe(401);
    },
  );

  it.each(['manifest', 'status'] as const)(
    'returns 401 for an invalid token on %s',
    async (path) => {
      const handler = path === 'manifest'
        ? createProjectManifestHandler(db)
        : createProjectStatusHandler(db);

      const response = await handler(
        request(path, 'dh_reg_not-valid'),
        context('deployhub'),
      );

      expect(response.status).toBe(401);
    },
  );

  it.each(['manifest', 'status'] as const)(
    'returns 401 for an expired token on %s',
    async (path) => {
      const token = await issue({
        expiresAt: new Date(Date.now() - 1_000),
      });
      const handler = path === 'manifest'
        ? createProjectManifestHandler(db)
        : createProjectStatusHandler(db);

      const response = await handler(
        request(path, token.raw),
        context('deployhub'),
      );

      expect(response.status).toBe(401);
    },
  );

  it('does not consume a single-use token across repeated reads', async () => {
    await seedProject();
    const token = await issue({ maxUses: 1 });
    const handler = createProjectManifestHandler(db);

    expect((await handler(
      request('manifest', token.raw),
      context('deployhub'),
    )).status).toBe(200);
    expect((await handler(
      request('manifest', token.raw),
      context('deployhub'),
    )).status).toBe(200);
    expect((await consumeToken(db, token.raw)).ok).toBe(true);
  });

  it.each(['manifest', 'status'] as const)(
    'returns 403 for a mismatched project_slug_constraint on %s',
    async (path) => {
      await seedProject();
      const token = await issue({ projectSlugConstraint: 'other-project' });
      const handler = path === 'manifest'
        ? createProjectManifestHandler(db)
        : createProjectStatusHandler(db);

      const response = await handler(
        request(path, token.raw),
        context('deployhub'),
      );

      expect(response.status).toBe(403);
    },
  );

  it.each(['manifest', 'status'] as const)(
    'returns 403 for a mismatched repository_constraint on %s',
    async (path) => {
      await seedProject();
      const token = await issue({ repositoryConstraint: 'other/repository' });
      const handler = path === 'manifest'
        ? createProjectManifestHandler(db)
        : createProjectStatusHandler(db);

      const response = await handler(
        request(path, token.raw),
        context('deployhub'),
      );

      expect(response.status).toBe(403);
    },
  );

  it.each(['manifest', 'status'] as const)(
    'returns 404 for an unknown slug on %s',
    async (path) => {
      const token = await issue();
      const handler = path === 'manifest'
        ? createProjectManifestHandler(db)
        : createProjectStatusHandler(db);

      const response = await handler(
        request(path, token.raw, 'missing'),
        context('missing'),
      );

      expect(response.status).toBe(404);
    },
  );

  it('returns the exact CLI manifest contract with a version header', async () => {
    const seeded = await seedProject();
    const token = await issue({
      repositoryConstraint: 'ktgo/deployhub',
      projectSlugConstraint: 'deployhub',
    });
    const handler = createProjectManifestHandler(db);

    const response = await handler(
      request('manifest', token.raw),
      context('deployhub'),
    );
    const text = await response.clone().text();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('x-manifest-version')).toBe(MANIFEST_VERSION);
    expect(body).toEqual({
      project: {
        name: 'DeployHub',
        slug: 'deployhub',
        description: 'Deployment inventory',
        lifecycle: 'production',
        importance: 5,
        owner: 'platform',
        repository: 'ktgo/deployhub',
        components: [
          {
            name: 'Web',
            componentType: 'frontend',
            framework: 'nextjs',
            runtime: 'node',
            language: 'typescript',
            criticality: 5,
            provider: 'hostinger',
            externalRef: 'deployhub-web-service',
            containerName: 'deployhub-web',
            url: 'https://hub.nolzza.net',
          },
          {
            name: 'Worker',
            componentType: 'worker',
            framework: null,
            runtime: 'node',
            language: 'typescript',
            criticality: 4,
            provider: null,
            externalRef: null,
            containerName: null,
            url: null,
          },
        ],
        domains: [
          {
            domain: 'deployhub.example.com',
            environment: 'production',
          },
        ],
      },
    });
    expect(text).not.toContain(token.raw);
    expect(text).not.toContain(seeded.encryptedToken);

    const parsedByCli = await getCurrentProject({
      baseUrl: 'http://localhost',
      slug: 'deployhub',
      token: token.raw,
      fetchImpl: async (input, init) => handler(
        new Request(String(input), init),
        context('deployhub'),
      ),
    });
    expect(parsedByCli.slug).toBe('deployhub');
    expect(parsedByCli.components[0]).toMatchObject({
      provider: 'hostinger',
      externalRef: 'deployhub-web-service',
      containerName: 'deployhub-web',
      url: 'https://hub.nolzza.net',
    });
  });

  it('returns counts and the latest Draft using the exact CLI status contract', async () => {
    const seeded = await seedProject();
    const token = await issue();
    const handler = createProjectStatusHandler(db);

    const response = await handler(
      request('status', token.raw),
      context('deployhub'),
    );
    const text = await response.clone().text();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      registered: true,
      slug: 'deployhub',
      name: 'DeployHub',
      status: 'active',
      lifecycle: 'production',
      componentCount: 2,
      linkedResourceCount: 1,
      latestDraft: {
        id: expect.any(String),
        status: 'pending_review',
        createdAt: seeded.latestCreatedAt.toISOString(),
      },
      projectUrl: '/projects/deployhub',
    });
    expect(text).not.toContain(token.raw);
    expect(text).not.toContain(seeded.encryptedToken);
    expect(text).not.toContain('encryptedToken');
    expect(text).not.toContain('encrypted_token');

    const parsedByCli = await getProjectStatus({
      baseUrl: 'http://localhost',
      slug: 'deployhub',
      token: token.raw,
      fetchImpl: async (input, init) => handler(
        new Request(String(input), init),
        context('deployhub'),
      ),
    });
    expect(parsedByCli).toEqual(body);
  });
});
