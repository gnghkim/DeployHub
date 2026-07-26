import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { startTestDb } from '../../test/helpers/pg';
import { schema, type Db } from '../index';
import {
  getDraft,
  insertDraft,
  listDrafts,
  updateDraftStatus,
} from './drafts';

let db: Db;
let stop: () => Promise<void>;
let submittedBy: string;
let projectId: string;

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
  await db.delete(schema.projects);
  await db.delete(schema.users);

  const [user] = await db
    .insert(schema.users)
    .values({
      githubId: 20_001n,
      githubLogin: 'draft-submitter',
    })
    .returning();
  if (!user) throw new Error('user insert failed');
  submittedBy = user.id;

  const [project] = await db
    .insert(schema.projects)
    .values({ name: 'DeployHub', slug: 'deployhub' })
    .returning();
  if (!project) throw new Error('project insert failed');
  projectId = project.id;
});

function draftValues(
  overrides: Partial<typeof schema.projectDrafts.$inferInsert> = {},
): typeof schema.projectDrafts.$inferInsert {
  return {
    projectId,
    manifestVersion: '1',
    manifestYaml: 'version: "1"\nproject:\n  slug: deployhub\n',
    fieldSources: { 'project.name': 'explicit' },
    sourceType: 'cli',
    submittedByType: 'user',
    submittedById: submittedBy,
    status: 'pending_review',
    validationResult: { success: true },
    diff: { project: [] },
    ...overrides,
  };
}

describe('project drafts', () => {
  it('stores a submitted draft as pending_review and returns it from list/get', async () => {
    const inserted = await insertDraft(db, draftValues());

    expect(inserted.status).toBe('pending_review');
    await expect(getDraft(db, inserted.id)).resolves.toEqual(inserted);
    expect((await listDrafts(db)).map((draft) => draft.id)).toContain(inserted.id);
  });

  it('preserves a validation_failed submission and its validation result', async () => {
    const validationResult = {
      success: false,
      issues: [{ path: 'project.slug', message: 'Required' }],
    };

    const inserted = await insertDraft(db, draftValues({
      projectId: null,
      status: 'validation_failed',
      validationResult,
    }));

    expect(inserted.status).toBe('validation_failed');
    expect((await getDraft(db, inserted.id))?.validationResult).toEqual(validationResult);
    expect(await listDrafts(db, { status: 'validation_failed' })).toHaveLength(1);
  });

  it('supersedes an existing pending_review draft for the same project', async () => {
    const first = await insertDraft(db, draftValues());
    const second = await insertDraft(db, draftValues({
      manifestYaml: 'version: "1"\nproject:\n  slug: deployhub\n  name: DeployHub v2\n',
    }));

    expect((await getDraft(db, first.id))?.status).toBe('superseded');
    expect((await getDraft(db, second.id))?.status).toBe('pending_review');
  });

  it('updates status and review metadata', async () => {
    const inserted = await insertDraft(db, draftValues());
    const reviewedAt = new Date();

    const updated = await updateDraftStatus(db, inserted.id, 'approved', {
      reviewedBy: submittedBy,
      reviewedAt,
    });

    expect(updated).toMatchObject({
      id: inserted.id,
      status: 'approved',
      reviewedBy: submittedBy,
      reviewedAt,
    });
  });
});
