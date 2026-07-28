import { desc, eq } from 'drizzle-orm';
import { schema } from '@deployhub/db';
import { loadEncryptionKey } from '@deployhub/shared';
import {
  enqueueGithubSync,
  saveGithubProvider,
} from '../../../actions/providers';
import { Topbar } from '../../../components/shell/topbar';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { db } from '../../../lib/db';
import { storedTokenSuffix } from '../../providers/provider-view';

export const dynamic = 'force-dynamic';

const DATE_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

async function connectGithub(formData: FormData): Promise<void> {
  'use server';
  await saveGithubProvider({ status: 'idle' }, formData);
}

function displayTokenSuffix(encryptedToken: string): string {
  try {
    const key = loadEncryptionKey(process.env.ENCRYPTION_KEY);
    return storedTokenSuffix(encryptedToken, key);
  } catch {
    return '확인 불가';
  }
}

export default async function ProvidersPage() {
  const accounts = await db
    .select({
      id: schema.providerAccounts.id,
      name: schema.providerAccounts.name,
      encryptedToken: schema.providerAccounts.encryptedToken,
      lastVerifiedAt: schema.providerAccounts.lastVerifiedAt,
      lastSyncAt: schema.providerAccounts.lastSyncAt,
      lastError: schema.providerAccounts.lastError,
    })
    .from(schema.providerAccounts)
    .where(eq(schema.providerAccounts.provider, 'github'))
    .orderBy(desc(schema.providerAccounts.createdAt));

  return (
    <>
      <Topbar title="Providers" />
      <main className="space-y-6 p-8">
        <div>
          <h2 className="text-xl font-medium text-[var(--color-ink)]">
            GitHub 연결
          </h2>
          <p className="mt-1 text-sm text-[var(--color-mute)]">
            토큰은 연결 확인 후 암호화해 저장하며 다시 표시하지 않습니다.
          </p>
        </div>

        <Card>
          <form action={connectGithub} className="flex items-end gap-3">
            <label className="min-w-0 flex-1 text-sm text-[var(--color-body)]">
              Personal access token
              <Input
                className="mt-2"
                name="token"
                type="password"
                autoComplete="off"
                required
              />
            </label>
            <Button variant="primary" type="submit">
              연결 테스트 및 저장
            </Button>
          </form>
        </Card>

        <div className="space-y-3">
          {accounts.map((account) => (
            <Card
              key={account.id}
              className="flex items-center justify-between gap-4"
            >
              <div>
                <h3 className="font-medium text-[var(--color-ink)]">
                  {account.name}
                </h3>
                <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-[var(--color-mute)]">토큰</dt>
                    <dd className="font-mono text-[var(--color-body)]">
                      ••••{displayTokenSuffix(account.encryptedToken)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--color-mute)]">
                      마지막 확인
                    </dt>
                    <dd className="text-[var(--color-body)]">
                      {account.lastVerifiedAt
                        ? DATE_FORMAT.format(account.lastVerifiedAt)
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--color-mute)]">
                      마지막 동기화
                    </dt>
                    <dd className="text-[var(--color-body)]">
                      {account.lastSyncAt
                        ? DATE_FORMAT.format(account.lastSyncAt)
                        : '—'}
                    </dd>
                  </div>
                </dl>
                {account.lastError ? (
                  <p className="mt-2 text-sm text-[var(--color-error)]">
                    {account.lastError}
                  </p>
                ) : null}
              </div>
              <form action={enqueueGithubSync}>
                <input type="hidden" name="accountId" value={account.id} />
                <Button type="submit">지금 동기화</Button>
              </form>
            </Card>
          ))}
          {accounts.length === 0 ? (
            <Card>
              <p className="text-sm text-[var(--color-mute)]">
                연결된 GitHub 계정이 없습니다.
              </p>
            </Card>
          ) : null}
        </div>
      </main>
    </>
  );
}
