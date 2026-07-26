import { desc, eq } from 'drizzle-orm';
import { schema } from '@deployhub/db';
import { auth } from '../../../auth/config';
import { revokeRegistrationToken } from '../../../actions/tokens';
import { Topbar } from '../../../components/shell/topbar';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { db } from '../../../lib/db';
import { TokenForm } from './token-form';

export const dynamic = 'force-dynamic';

const DATE_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export default async function RegistrationTokensPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) throw new Error('인증이 필요합니다.');

  const tokens = await db
    .select({
      id: schema.registrationTokens.id,
      scope: schema.registrationTokens.scope,
      repositoryConstraint:
        schema.registrationTokens.repositoryConstraint,
      projectSlugConstraint:
        schema.registrationTokens.projectSlugConstraint,
      expiresAt: schema.registrationTokens.expiresAt,
      maxUses: schema.registrationTokens.maxUses,
      usedCount: schema.registrationTokens.usedCount,
      revokedAt: schema.registrationTokens.revokedAt,
      createdAt: schema.registrationTokens.createdAt,
    })
    .from(schema.registrationTokens)
    .where(eq(schema.registrationTokens.createdBy, userId))
    .orderBy(desc(schema.registrationTokens.createdAt));

  const now = new Date();

  return (
    <>
      <Topbar title="Registration tokens" />
      <main className="space-y-6 p-8">
        <Card>
          <h2 className="text-lg font-medium text-[var(--color-ink)]">
            CLI 등록 토큰 발급
          </h2>
          <p className="mb-5 mt-1 text-sm text-[var(--color-mute)]">
            토큰 원문은 발급 직후 한 번만 표시되며 이후에는 조회할 수 없습니다.
          </p>
          <TokenForm />
        </Card>

        <Card>
          <h2 className="mb-4 text-lg font-medium text-[var(--color-ink)]">
            발급 내역
          </h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>상태</TableHead>
                <TableHead>제한</TableHead>
                <TableHead>사용</TableHead>
                <TableHead>만료</TableHead>
                <TableHead>발급</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((token) => {
                const expired = token.expiresAt <= now;
                const exhausted = token.usedCount >= token.maxUses;
                const status = token.revokedAt
                  ? 'revoked'
                  : expired
                    ? 'expired'
                    : exhausted
                      ? 'used'
                      : 'active';
                const revoke = revokeRegistrationToken.bind(null, token.id);
                return (
                  <TableRow key={token.id}>
                    <TableCell>
                      <Badge
                        tone={status === 'active' ? 'success' : 'neutral'}
                      >
                        {status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {token.repositoryConstraint
                        ?? token.projectSlugConstraint
                        ?? '제한 없음'}
                    </TableCell>
                    <TableCell>
                      {token.usedCount}/{token.maxUses}
                    </TableCell>
                    <TableCell>
                      {DATE_FORMAT.format(token.expiresAt)}
                    </TableCell>
                    <TableCell>
                      {DATE_FORMAT.format(token.createdAt)}
                    </TableCell>
                    <TableCell>
                      {status === 'active' ? (
                        <form action={revoke}>
                          <Button type="submit" variant="tertiary">
                            폐기
                          </Button>
                        </form>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {tokens.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--color-mute)]">
              발급된 토큰이 없습니다.
            </p>
          ) : null}
        </Card>
      </main>
    </>
  );
}
