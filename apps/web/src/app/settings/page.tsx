import Link from 'next/link';
import { Topbar } from '@/components/shell/topbar';

const SETTINGS_ITEMS = [
  {
    label: '자원',
    description: '수집된 저장소와 컨테이너',
    href: '/settings/resources',
  },
  {
    label: 'Provider',
    description: 'GitHub·Vercel 등 연동 계정',
    href: '/settings/providers',
  },
  {
    label: '등록 초안',
    description: 'AI가 올린 등록 요청 승인',
    href: '/settings/drafts',
  },
  {
    label: '등록 토큰',
    description: 'CLI 등록에 쓰는 일회용 토큰',
    href: '/settings/tokens',
  },
] as const;

export default function SettingsPage() {
  return (
    <>
      <Topbar title="설정" />
      <main className="p-4 md:p-8">
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--rule)] bg-[var(--paper)]">
          <ul className="divide-y divide-[var(--rule)]">
            {SETTINGS_ITEMS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="grid gap-1 px-5 py-4 transition-colors hover:bg-white/[0.02] sm:grid-cols-[10rem_1fr] sm:items-center sm:gap-4"
                >
                  <span className="font-medium text-[var(--line)]">
                    {item.label}
                  </span>
                  <span className="text-sm text-[var(--annotation)]">
                    {item.description}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </>
  );
}
