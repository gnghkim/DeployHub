import { desc } from 'drizzle-orm';
import { schema } from '@deployhub/db';
import { loadEncryptionKey } from '@deployhub/shared';
import {
  enqueueGithubSync,
  enqueueVercelSync,
  saveGithubProvider,
  saveVercelProvider,
} from '../../../actions/providers';
import { Topbar } from '../../../components/shell/topbar';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { Input } from '../../../components/ui/input';
import { db } from '../../../lib/db';
import { storedTokenSuffix } from '../../providers/provider-view';
import { ProviderAccountCard } from './components/provider-account-card';

export const dynamic = 'force-dynamic';

async function connectGithub(formData: FormData): Promise<void> {
  'use server';
  await saveGithubProvider({ status: 'idle' }, formData);
}

async function connectVercel(formData: FormData): Promise<void> {
  'use server';
  await saveVercelProvider({ status: 'idle' }, formData);
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
      provider: schema.providerAccounts.provider,
      name: schema.providerAccounts.name,
      encryptedToken: schema.providerAccounts.encryptedToken,
      lastVerifiedAt: schema.providerAccounts.lastVerifiedAt,
      lastSyncAt: schema.providerAccounts.lastSyncAt,
      lastError: schema.providerAccounts.lastError,
    })
    .from(schema.providerAccounts)
    .orderBy(desc(schema.providerAccounts.createdAt));

  const githubAccounts = accounts.filter(
    (account) => account.provider === 'github',
  );
  const vercelAccounts = accounts.filter(
    (account) => account.provider === 'vercel',
  );

  return (
    <>
      <Topbar title="Providers" />
      <main className="space-y-10 p-4 md:p-8">
        <section className="space-y-6">
          <div>
            <h2 className="text-xl font-medium text-[var(--line)]">
              GitHub 연결
            </h2>
            <p className="mt-1 text-sm text-[var(--annotation)]">
              토큰은 연결 확인 후 암호화해 저장하며 다시 표시하지 않습니다.
            </p>
          </div>

          <Card>
            <form action={connectGithub} className="flex items-end gap-3">
              <label className="min-w-0 flex-1 text-sm text-[var(--line-mute)]">
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
            {githubAccounts.map((account) => (
              <ProviderAccountCard
                key={account.id}
                id={account.id}
                name={account.name}
                tokenSuffix={displayTokenSuffix(account.encryptedToken)}
                lastVerifiedAt={account.lastVerifiedAt}
                lastSyncAt={account.lastSyncAt}
                lastError={account.lastError}
                syncAction={enqueueGithubSync}
              />
            ))}
            {githubAccounts.length === 0 ? (
              <Card>
                <p className="text-sm text-[var(--annotation)]">
                  연결된 GitHub 계정이 없습니다.
                </p>
              </Card>
            ) : null}
          </div>
        </section>

        <section className="space-y-6">
          <div>
            <h2 className="text-xl font-medium text-[var(--line)]">
              Vercel 연결
            </h2>
            <p className="mt-1 text-sm text-[var(--annotation)]">
              토큰은 연결 확인 후 암호화해 저장하며 다시 표시하지 않습니다.
            </p>
          </div>

          <Card>
            <form action={connectVercel} className="flex items-end gap-3">
              <label className="min-w-0 flex-1 text-sm text-[var(--line-mute)]">
                Access token
                <Input
                  className="mt-2"
                  name="token"
                  type="password"
                  autoComplete="off"
                  required
                />
              </label>
              <label className="min-w-0 flex-1 text-sm text-[var(--line-mute)]">
                Team ID (선택)
                <Input
                  className="mt-2"
                  name="teamId"
                  type="text"
                  autoComplete="off"
                  aria-describedby="vercel-team-id-help"
                />
                <span
                  id="vercel-team-id-help"
                  className="mt-1 block text-xs text-[var(--annotation)]"
                >
                  개인 계정이면 비워둡니다
                </span>
              </label>
              <Button variant="primary" type="submit">
                연결 테스트 및 저장
              </Button>
            </form>
          </Card>

          <div className="space-y-3">
            {vercelAccounts.map((account) => (
              <ProviderAccountCard
                key={account.id}
                id={account.id}
                name={account.name}
                tokenSuffix={displayTokenSuffix(account.encryptedToken)}
                lastVerifiedAt={account.lastVerifiedAt}
                lastSyncAt={account.lastSyncAt}
                lastError={account.lastError}
                syncAction={enqueueVercelSync}
              />
            ))}
            {vercelAccounts.length === 0 ? (
              <Card>
                <p className="text-sm text-[var(--annotation)]">
                  연결된 Vercel 계정이 없습니다.
                </p>
              </Card>
            ) : null}
          </div>
        </section>
      </main>
    </>
  );
}
