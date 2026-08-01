import { sql } from 'drizzle-orm';
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
  consumeToken,
  hashToken,
  issueToken,
  revokeToken,
  verifyToken,
} from './tokens';

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
  await db.delete(schema.registrationTokens);
  await db.delete(schema.users);
  const [user] = await db
    .insert(schema.users)
    .values({
      githubId: 10_001n,
      githubLogin: 'token-issuer',
    })
    .returning();
  if (!user) throw new Error('user insert failed');
  createdBy = user.id;
});

function issue(overrides: Partial<Parameters<typeof issueToken>[1]> = {}) {
  return issueToken(db, {
    scope: 'project:draft:create',
    repositoryConstraint: 'ktgo/deployhub',
    expiresAt: new Date(Date.now() + 60_000),
    maxUses: 1,
    createdBy,
    ...overrides,
  });
}

describe('registration tokens', () => {
  it('consumes an issued raw token successfully', async () => {
    const issued = await issue();

    await expect(consumeToken(db, issued.raw)).resolves.toEqual({
      ok: true,
      tokenId: issued.id,
      scope: 'project:draft:create',
      repositoryConstraint: 'ktgo/deployhub',
      projectSlugConstraint: null,
    });
  });

  it('verifies a token repeatedly without consuming its single use', async () => {
    const issued = await issue({
      projectSlugConstraint: 'deployhub',
      maxUses: 1,
    });

    const expected = {
      ok: true,
      tokenId: issued.id,
      scope: 'project:draft:create',
      repositoryConstraint: 'ktgo/deployhub',
      projectSlugConstraint: 'deployhub',
    };
    await expect(verifyToken(db, issued.raw)).resolves.toEqual(expected);
    await expect(verifyToken(db, issued.raw)).resolves.toEqual(expected);
    await expect(consumeToken(db, issued.raw)).resolves.toEqual(expected);
  });

  it('verifies a token that already spent its last use', async () => {
    const issued = await issue({ maxUses: 1 });
    expect((await consumeToken(db, issued.raw)).ok).toBe(true);

    await expect(verifyToken(db, issued.raw)).resolves.toEqual({
      ok: true,
      tokenId: issued.id,
      scope: 'project:draft:create',
      repositoryConstraint: 'ktgo/deployhub',
      projectSlugConstraint: null,
    });
  });

  it.each([
    ['unknown', 'dh_reg_not-a-real-token', 'not_found'],
    ['expired', undefined, 'expired'],
    ['revoked', undefined, 'revoked'],
  ] as const)(
    'reports a %s token while verifying',
    async (kind, rawOverride, reason) => {
      if (kind === 'unknown') {
        await expect(verifyToken(db, rawOverride ?? '')).resolves.toEqual({
          ok: false,
          reason,
        });
        return;
      }

      const issued = await issue({
        ...(kind === 'expired'
          ? { expiresAt: new Date(Date.now() - 1_000) }
          : {}),
      });
      if (kind === 'revoked') await revokeToken(db, issued.id);

      await expect(verifyToken(db, issued.raw)).resolves.toEqual({
        ok: false,
        reason,
      });
    },
  );

  it('never stores the raw token in any database column', async () => {
    const issued = await issue();

    const result = await db.execute<Record<string, unknown>>(
      sql`select * from registration_tokens`,
    );

    expect(result.rows).toHaveLength(1);
    expect(JSON.stringify(result.rows[0])).not.toContain(issued.raw);
    expect(result.rows[0]?.token_hash).toBe(hashToken(issued.raw));
  });

  it('reports an unknown token as not_found', async () => {
    await expect(consumeToken(db, 'dh_reg_not-a-real-token')).resolves.toEqual({
      ok: false,
      reason: 'not_found',
    });
  });

  it('reports a token past expires_at as expired', async () => {
    const issued = await issue({ expiresAt: new Date(Date.now() - 1_000) });

    await expect(consumeToken(db, issued.raw)).resolves.toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('reports a single-use token as exhausted after its first use', async () => {
    const issued = await issue({ maxUses: 1 });

    expect((await consumeToken(db, issued.raw)).ok).toBe(true);
    await expect(consumeToken(db, issued.raw)).resolves.toEqual({
      ok: false,
      reason: 'exhausted',
    });
  });

  it('reports a revoked token as revoked', async () => {
    const issued = await issue();
    await revokeToken(db, issued.id);

    await expect(consumeToken(db, issued.raw)).resolves.toEqual({
      ok: false,
      reason: 'revoked',
    });
  });

  it('allows exactly one of two concurrent consumes for a single-use token', async () => {
    const issued = await issue({ maxUses: 1 });

    const results = await Promise.all([
      consumeToken(db, issued.raw),
      consumeToken(db, issued.raw),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter(
      (result) => !result.ok && result.reason === 'exhausted',
    )).toHaveLength(1);
  });

  it('issues a dh_reg_ token containing at least 32 random bytes', async () => {
    const issued = await issue();
    const encodedRandomBytes = issued.raw.slice('dh_reg_'.length);

    expect(issued.raw).toMatch(/^dh_reg_[A-Za-z0-9_-]+$/);
    expect(Buffer.from(encodedRandomBytes, 'base64url').byteLength).toBeGreaterThanOrEqual(32);
  });

  it('issues different raw tokens for identical options', async () => {
    const first = await issue();
    const second = await issue();

    expect(first.raw).not.toBe(second.raw);
  });
});
