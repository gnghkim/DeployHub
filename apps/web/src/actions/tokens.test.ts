import { eq } from 'drizzle-orm';
import { schema, type Db } from '@deployhub/db';
import {
  afterAll,
  afterEach,
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
  issueRegistrationToken,
  revokeRegistrationToken,
} from './tokens';

let db: Db;
let stop: () => Promise<void>;
let userId: string;

beforeAll(async () => {
  const started = await startTestDb();
  db = started.db;
  dbState.current = db as unknown as Record<PropertyKey, unknown>;
  stop = started.stop;
}, 120_000);

afterAll(async () => {
  await stop();
});

afterEach(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  await db.delete(schema.projectDrafts);
  await db.delete(schema.registrationTokens);
  await db.delete(schema.users);
  const [user] = await db
    .insert(schema.users)
    .values({
      githubId: BigInt(Date.now()),
      githubLogin: `token-reviewer-${Date.now()}`,
    })
    .returning();
  if (!user) throw new Error('user insert failed');
  userId = user.id;
  authMock.mockReset();
  authMock.mockResolvedValue({ user: { id: userId } });
  revalidatePathMock.mockReset();
});

function tokenForm(): FormData {
  const formData = new FormData();
  formData.set('expiresInHours', '24');
  formData.set('maxUses', '1');
  formData.set('repositoryConstraint', 'ktgo/deployhub');
  return formData;
}

describe('registration token actions', () => {
  it('rejects token issuance without a session', async () => {
    authMock.mockResolvedValue(null);

    await expect(issueRegistrationToken(tokenForm())).rejects.toThrow(/인증/);
  });

  it('calculates expiresAt from the web process clock', async () => {
    const now = new Date('2026-07-26T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    await issueRegistrationToken(tokenForm());

    const [token] = await db.select().from(schema.registrationTokens);
    expect(token?.expiresAt).toEqual(
      new Date(now.getTime() + 24 * 60 * 60 * 1_000),
    );
  });

  it('returns the raw token once while storing only its hash', async () => {
    const result = await issueRegistrationToken(tokenForm());
    const [stored] = await db.select().from(schema.registrationTokens);

    expect(result).toMatchObject({
      status: 'success',
      rawToken: expect.stringMatching(/^dh_reg_/),
    });
    expect(JSON.stringify(stored)).not.toContain(result.rawToken);
  });

  it('revokes an issued token', async () => {
    await issueRegistrationToken(tokenForm());
    const [stored] = await db.select().from(schema.registrationTokens);
    if (!stored) throw new Error('token insert failed');

    await revokeRegistrationToken(stored.id);

    const [revoked] = await db
      .select()
      .from(schema.registrationTokens)
      .where(eq(schema.registrationTokens.id, stored.id));
    expect(revoked?.revokedAt).toBeInstanceOf(Date);
  });
});
