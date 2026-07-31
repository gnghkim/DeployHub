import { Button } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { formatDateTime } from '../../../../lib/datetime';

export type ProviderAccountCardProps = {
  id: string;
  name: string;
  tokenSuffix: string;
  lastVerifiedAt: Date | null;
  lastSyncAt: Date | null;
  lastError: string | null;
  syncAction: (formData: FormData) => Promise<void>;
};

export function ProviderAccountCard({
  id,
  name,
  tokenSuffix,
  lastVerifiedAt,
  lastSyncAt,
  lastError,
  syncAction,
}: ProviderAccountCardProps) {
  return (
    <Card className="flex items-center justify-between gap-4">
      <div>
        <h3 className="font-medium text-[var(--line)]">{name}</h3>
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-[var(--annotation)]">토큰</dt>
            <dd className="font-mono text-[var(--line-mute)]">
              ••••{tokenSuffix}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--annotation)]">마지막 확인</dt>
            <dd className="font-mono text-[var(--line-mute)]">
              {lastVerifiedAt
                ? formatDateTime(lastVerifiedAt)
                : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--annotation)]">
              마지막 동기화
            </dt>
            <dd className="font-mono text-[var(--line-mute)]">
              {lastSyncAt ? formatDateTime(lastSyncAt) : '—'}
            </dd>
          </div>
        </dl>
        {lastError ? (
          <p className="mt-2 text-sm text-[var(--fault)]">{lastError}</p>
        ) : null}
      </div>
      <form action={syncAction}>
        <input type="hidden" name="accountId" value={id} />
        <Button type="submit">지금 동기화</Button>
      </form>
    </Card>
  );
}
