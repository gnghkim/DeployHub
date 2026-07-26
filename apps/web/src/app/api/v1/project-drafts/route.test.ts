import { eq } from 'drizzle-orm';
import {
  consumeToken,
  issueToken,
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
} from 'vitest';
import { startTestDb } from '../../../../../../../packages/db/test/helpers/pg';
import { createProjectDraftHandler } from './route';

const VALID_MANIFEST = `apiVersion: deployhub.io/v1
kind: Project
metadata:
  name: DeployHub
  slug: deployhub
  description: Submitted description
spec:
  lifecycle: production
  importance: 4
  repository:
    provider: github
    slug: ktgo/deployhub
  components:
    - name: web
      type: frontend
      framework: nextjs
    - name: worker
      type: worker
`;

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
  await db.delete(schema.components);
  await db.delete(schema.projects);
  await db.delete(schema.users);

  const [user] = await db
    .insert(schema.users)
    .values({
      githubId: BigInt(Date.now()),
      githubLogin: `issuer-${Date.now()}`,
    })
    .returning();
  if (!user) throw new Error('user insert failed');
  createdBy = user.id;
});

const issue = (
  overrides: Partial<Parameters<typeof issueToken>[1]> = {},
) => issueToken(db, {
  scope: 'project:register',
  expiresAt: new Date(Date.now() + 60_000),
  createdBy,
  ...overrides,
});

const request = (
  token: string | undefined,
  manifestYaml = VALID_MANIFEST,
  url = 'http://localhost/api/v1/project-drafts',
): Request => {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      manifestYaml,
      fieldSources: {
        web: {
          framework: {
            origin: 'detected',
            evidence: 'next@16.2.12',
            source: 'package.json',
          },
        },
      },
    }),
  });
};

describe('POST /api/v1/project-drafts', () => {
  it('creates a pending_review Draft for a valid token and manifest', async () => {
    const token = await issue();

    const response = await createProjectDraftHandler(db)(request(token.raw));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ status: 'pending_review' });
    expect(await db.select().from(schema.projectDrafts)).toHaveLength(1);
  });

  it('returns 401 without querying the database when the token is missing', async () => {
    const noDatabase = new Proxy({} as Db, {
      get() {
        throw new Error('database must not be queried');
      },
    });

    const response = await createProjectDraftHandler(noDatabase)(
      request(
        undefined,
        VALID_MANIFEST,
        'http://localhost/api/v1/project-drafts?token=dh_reg_query-forbidden',
      ),
    );

    expect(response.status).toBe(401);
  });

  it('returns 401 for an invalid token', async () => {
    const response = await createProjectDraftHandler(db)(
      request('dh_reg_not-valid'),
    );

    expect(response.status).toBe(401);
  });

  it('returns 401 for an expired token', async () => {
    const token = await issue({
      expiresAt: new Date(Date.now() - 1_000),
    });

    const response = await createProjectDraftHandler(db)(request(token.raw));

    expect(response.status).toBe(401);
  });

  it('returns 401 for an already consumed token', async () => {
    const token = await issue();
    expect((await consumeToken(db, token.raw)).ok).toBe(true);

    const response = await createProjectDraftHandler(db)(request(token.raw));

    expect(response.status).toBe(401);
  });

  it('creates validation_failed and consumes the token for an invalid manifest', async () => {
    const token = await issue();

    const response = await createProjectDraftHandler(db)(
      request(token.raw, 'not-a-manifest: true'),
    );
    const retry = await createProjectDraftHandler(db)(
      request(token.raw, 'not-a-manifest: true'),
    );
    const [storedToken] = await db
      .select({ usedCount: schema.registrationTokens.usedCount })
      .from(schema.registrationTokens)
      .where(eq(schema.registrationTokens.id, token.id));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      status: 'validation_failed',
    });
    expect(storedToken?.usedCount).toBe(1);
    expect(retry.status).toBe(401);
  });

  it('returns 403 when repository_constraint does not match the manifest', async () => {
    const token = await issue({
      repositoryConstraint: 'other/repository',
    });

    const response = await createProjectDraftHandler(db)(request(token.raw));

    expect(response.status).toBe(403);
  });

  it('returns 413 when the request body exceeds 256KB', async () => {
    const token = await issue();

    const response = await createProjectDraftHandler(db)(
      request(token.raw, 'x'.repeat(256 * 1024)),
    );

    expect(response.status).toBe(413);
  });

  it('never reflects the bearer token in a response body', async () => {
    const token = await issue();

    const response = await createProjectDraftHandler(db)(request(token.raw));

    expect(await response.text()).not.toContain(token.raw);
  });

  it('creates only a Draft and does not mutate projects or components', async () => {
    const [project] = await db
      .insert(schema.projects)
      .values({
        name: 'Existing name',
        slug: 'deployhub',
        description: 'Existing description',
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
    const token = await issue();

    const response = await createProjectDraftHandler(db)(request(token.raw));
    const [storedProject] = await db.select().from(schema.projects);
    const [storedComponent] = await db.select().from(schema.components);
    const [draft] = await db.select().from(schema.projectDrafts);

    expect(response.status).toBe(201);
    expect(storedProject).toMatchObject({
      id: project.id,
      name: 'Existing name',
      description: 'Existing description',
      lifecycle: 'development',
    });
    expect(storedComponent).toMatchObject({
      name: 'web',
      componentType: 'backend',
      framework: 'express',
    });
    expect(draft).toMatchObject({
      projectId: project.id,
      status: 'pending_review',
    });
  });
});
