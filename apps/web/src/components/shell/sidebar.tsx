import Link from 'next/link';

const ACTIVE_ITEMS = [
  { label: '프로젝트', href: '/' },
  { label: '발견', href: '/discovered' },
  { label: 'Providers', href: '/providers' },
  { label: 'Resources', href: '/resources' },
  { label: 'Drafts', href: '/drafts' },
  { label: 'Registration tokens', href: '/settings/tokens' },
] as const;

const INACTIVE_ITEMS = [
  'Infrastructure',
  'Deployments',
  'Monitors',
  'Domains',
  'Alerts',
  'Documents',
] as const;

export function Sidebar() {
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
            {item.label}
          </Link>
        ))}
        {INACTIVE_ITEMS.map((label) => (
          <span
            key={label}
            aria-disabled="true"
            className="cursor-not-allowed rounded-[var(--radius-row)] px-3 py-2 text-sm text-[var(--color-ash)]"
          >
            {label}
          </span>
        ))}
      </nav>
      <div className="mt-auto border-t border-[var(--color-hairline)] px-3 pt-4 text-xs text-[var(--color-mute)]">
        System status
      </div>
    </aside>
  );
}
