import Link from 'next/link';
import { connection } from 'next/server';
import { listDrafts } from '@deployhub/db';
import { db } from '@/lib/db';

const ACTIVE_ITEMS = [
  { label: '프로젝트', href: '/' },
  { label: '발견', href: '/discovered' },
  { label: '설정', href: '/settings' },
] as const;

export async function Sidebar() {
  await connection();
  const pendingDrafts = await listDrafts(db, { status: 'pending_review' });

  return (
    <aside className="sticky top-0 flex h-screen w-[240px] shrink-0 flex-col border-r border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-4">
      <div className="px-3 pb-5 text-sm font-semibold tracking-wide text-[var(--color-ink)]">
        DeployHub
      </div>
      <nav aria-label="Primary navigation" className="flex flex-col gap-1">
        {ACTIVE_ITEMS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-[var(--radius-row)] px-3 py-2 text-sm text-[var(--color-body)] transition-colors hover:bg-[var(--color-surface-card)] hover:text-[var(--color-ink)]"
          >
            <span className="flex items-center justify-between gap-3">
              {item.label}
              {item.href === '/settings' && pendingDrafts.length > 0 ? (
                <span className="px-1 text-xs font-medium text-[var(--color-warning)]">
                  {pendingDrafts.length}
                </span>
              ) : null}
            </span>
          </Link>
        ))}
      </nav>
      <div className="mt-auto border-t border-[var(--color-hairline)] px-3 pt-4 text-xs text-[var(--color-mute)]">
        System status
      </div>
    </aside>
  );
}
