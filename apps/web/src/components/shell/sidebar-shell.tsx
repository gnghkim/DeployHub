'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const ACTIVE_ITEMS = [
  { label: '프로젝트', href: '/' },
  { label: '발견', href: '/discovered' },
  { label: '변경', href: '/events' },
  { label: '설정', href: '/settings' },
] as const;

export function SidebarShell({
  pendingDraftCount,
}: {
  pendingDraftCount: number;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const manualActive = pathname === '/manual';

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
        className="fixed left-4 top-3 z-[60] flex h-10 w-10 items-center justify-center rounded-[var(--radius-button)] border border-[var(--rule)] bg-[var(--paper)] text-[var(--line)] md:hidden"
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
          className="fixed inset-0 z-40 bg-[var(--canvas)] opacity-80 md:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        id="primary-navigation"
        className={`fixed inset-y-0 left-0 z-50 flex h-screen w-[240px] shrink-0 flex-col border-r border-[var(--rule)] bg-[var(--paper)] px-3 py-4 transition-transform ${
          open ? 'translate-x-0' : '-translate-x-full'
        } md:sticky md:top-0 md:bottom-auto md:z-auto md:translate-x-0 md:transition-none`}
      >
        <div className="px-3 pb-5 pl-14 text-sm font-semibold tracking-wide text-[var(--line)] md:px-3">
          DeployHub
        </div>
        <nav aria-label="Primary navigation" className="flex flex-col gap-1">
          {ACTIVE_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="rounded-[var(--radius-button)] px-3 py-2 text-sm text-[var(--line-mute)] transition-colors hover:bg-white/[0.02] hover:text-[var(--line)]"
            >
              <span className="flex items-center justify-between gap-3">
                {item.label}
                {item.href === '/settings' && pendingDraftCount > 0 ? (
                  <span className="px-1 text-xs font-medium text-[var(--caution)]">
                    {pendingDraftCount}
                  </span>
                ) : null}
              </span>
            </Link>
          ))}
        </nav>
        <div className="mt-auto border-t border-[var(--rule)] px-3 pt-4 text-xs">
          <Link
            href="/manual"
            aria-current={manualActive ? 'page' : undefined}
            onClick={() => setOpen(false)}
            className={`block rounded-[var(--radius-button)] px-2 py-2 transition-colors ${
              manualActive
                ? 'bg-white/[0.04] text-[var(--line)]'
                : 'text-[var(--line-mute)] hover:bg-white/[0.02] hover:text-[var(--line)]'
            }`}
          >
            사용 매뉴얼
          </Link>
          <div className="px-2 pt-3 text-[var(--annotation)]">
            System status
          </div>
        </div>
      </aside>
    </>
  );
}
