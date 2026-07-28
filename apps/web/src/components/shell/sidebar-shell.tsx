'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const ACTIVE_ITEMS = [
  { label: '프로젝트', href: '/' },
  { label: '발견', href: '/discovered' },
  { label: '설정', href: '/settings' },
] as const;

export function SidebarShell({
  pendingDraftCount,
}: {
  pendingDraftCount: number;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px)');
    const closeAtDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };
    desktop.addEventListener('change', closeAtDesktop);

    return () => {
      desktop.removeEventListener('change', closeAtDesktop);
    };
  }, []);

  return (
    <>
      <button
        type="button"
        className="fixed left-4 top-3 z-[60] flex h-10 w-10 items-center justify-center rounded-[var(--radius-button)] border border-[var(--color-hairline)] bg-[var(--color-surface)] text-[var(--color-ink)] md:hidden"
        aria-label={open ? '내비게이션 닫기' : '내비게이션 열기'}
        aria-expanded={open}
        aria-controls="primary-navigation"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true" className="text-xl leading-none">
          {open ? '×' : '☰'}
        </span>
      </button>

      {open ? (
        <button
          type="button"
          aria-label="내비게이션 배경 닫기"
          className="fixed inset-0 z-40 bg-[var(--color-canvas)] opacity-80 md:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        id="primary-navigation"
        className={`fixed inset-y-0 left-0 z-50 flex h-screen w-[240px] shrink-0 flex-col border-r border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 py-4 transition-transform ${
          open ? 'translate-x-0' : '-translate-x-full'
        } md:sticky md:top-0 md:bottom-auto md:z-auto md:translate-x-0 md:transition-none`}
      >
        <div className="px-3 pb-5 pl-14 text-sm font-semibold tracking-wide text-[var(--color-ink)] md:px-3">
          DeployHub
        </div>
        <nav aria-label="Primary navigation" className="flex flex-col gap-1">
          {ACTIVE_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="rounded-[var(--radius-row)] px-3 py-2 text-sm text-[var(--color-body)] transition-colors hover:bg-[var(--color-surface-card)] hover:text-[var(--color-ink)]"
            >
              <span className="flex items-center justify-between gap-3">
                {item.label}
                {item.href === '/settings' && pendingDraftCount > 0 ? (
                  <span className="px-1 text-xs font-medium text-[var(--color-warning)]">
                    {pendingDraftCount}
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
    </>
  );
}
