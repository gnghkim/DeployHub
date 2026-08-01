import { createHash, randomBytes } from 'node:crypto';
import {
  and,
  eq,
  gt,
  isNull,
  lt,
  sql,
} from 'drizzle-orm';
import type { Db } from '../client';
import { registrationTokens } from '../schema/registration';

export type IssueTokenOptions = {
  scope: string;
  repositoryConstraint?: string | null;
  projectSlugConstraint?: string | null;
  expiresAt: Date;
  maxUses?: number;
  createdBy: string;
};

export type ConsumeResult =
  | {
    ok: true;
    tokenId: string;
    scope: string;
    repositoryConstraint: string | null;
    projectSlugConstraint: string | null;
  }
  | {
    ok: false;
    reason: 'not_found' | 'expired' | 'exhausted' | 'revoked';
  };

export type VerifyResult =
  | {
    ok: true;
    tokenId: string;
    scope: string;
    repositoryConstraint: string | null;
    projectSlugConstraint: string | null;
  }
  | {
    ok: false;
    reason: 'not_found' | 'expired' | 'exhausted' | 'revoked';
  };

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export async function issueToken(
  db: Db,
  opts: IssueTokenOptions,
): Promise<{ raw: string; id: string }> {
  const raw = `dh_reg_${randomBytes(32).toString('base64url')}`;
  const [token] = await db
    .insert(registrationTokens)
    .values({
      tokenHash: hashToken(raw),
      scope: opts.scope,
      repositoryConstraint: opts.repositoryConstraint,
      projectSlugConstraint: opts.projectSlugConstraint,
      expiresAt: opts.expiresAt,
      maxUses: opts.maxUses ?? 1,
      createdBy: opts.createdBy,
    })
    .returning({ id: registrationTokens.id });
  if (!token) throw new Error('registration token insert failed');
  return { raw, id: token.id };
}

export async function consumeToken(db: Db, raw: string): Promise<ConsumeResult> {
  const tokenHash = hashToken(raw);
  const now = new Date();
  const [consumed] = await db
    .update(registrationTokens)
    .set({
      usedCount: sql`${registrationTokens.usedCount} + 1`,
    })
    .where(and(
      eq(registrationTokens.tokenHash, tokenHash),
      lt(registrationTokens.usedCount, registrationTokens.maxUses),
      gt(registrationTokens.expiresAt, now),
      isNull(registrationTokens.revokedAt),
    ))
    .returning({
      tokenId: registrationTokens.id,
      scope: registrationTokens.scope,
      repositoryConstraint: registrationTokens.repositoryConstraint,
      projectSlugConstraint: registrationTokens.projectSlugConstraint,
    });

  if (consumed) {
    return { ok: true, ...consumed };
  }

  return tokenFailureResult(db, tokenHash, now);
}

export async function verifyToken(db: Db, raw: string): Promise<VerifyResult> {
  const tokenHash = hashToken(raw);
  const now = new Date();
  const [verified] = await db
    .select({
      tokenId: registrationTokens.id,
      scope: registrationTokens.scope,
      repositoryConstraint: registrationTokens.repositoryConstraint,
      projectSlugConstraint: registrationTokens.projectSlugConstraint,
    })
    .from(registrationTokens)
    .where(and(
      eq(registrationTokens.tokenHash, tokenHash),
      // Read-only checks (status, diff) do not consume a use, so a token that
      // spent its last use on a Draft submission must still verify. Otherwise
      // the default single-use token breaks the register -> status -> diff flow.
      gt(registrationTokens.expiresAt, now),
      isNull(registrationTokens.revokedAt),
    ));

  if (verified) {
    return { ok: true, ...verified };
  }

  return tokenFailureResult(db, tokenHash, now);
}

async function tokenFailureResult(
  db: Db,
  tokenHash: string,
  now: Date,
): Promise<Extract<ConsumeResult, { ok: false }>> {
  const [token] = await db
    .select({
      expiresAt: registrationTokens.expiresAt,
      maxUses: registrationTokens.maxUses,
      usedCount: registrationTokens.usedCount,
      revokedAt: registrationTokens.revokedAt,
    })
    .from(registrationTokens)
    .where(eq(registrationTokens.tokenHash, tokenHash));

  if (!token) return { ok: false, reason: 'not_found' };
  if (token.revokedAt) return { ok: false, reason: 'revoked' };
  if (token.expiresAt <= now) return { ok: false, reason: 'expired' };
  if (token.usedCount >= token.maxUses) return { ok: false, reason: 'exhausted' };
  return { ok: false, reason: 'not_found' };
}

export async function revokeToken(db: Db, id: string): Promise<void> {
  await db
    .update(registrationTokens)
    .set({ revokedAt: new Date() })
    .where(eq(registrationTokens.id, id));
}
