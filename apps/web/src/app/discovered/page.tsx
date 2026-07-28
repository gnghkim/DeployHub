import Link from 'next/link';
import { listDiscoveredStacks } from '@deployhub/db';
import { Topbar } from '@/components/shell/topbar';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function DiscoveredPage() {
  const stacks = await listDiscoveredStacks(db);

  return (
    <>
      <Topbar title="발견" />
      <main className="space-y-6 p-4 md:p-8">
        <section className="rounded-[var(--radius-card)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5 text-sm">
          <p className="text-[var(--color-body)]">
            등록하려면 해당 프로젝트를 작업 중인 AI에게
            {' '}&quot;DeployHub에 등록해줘&quot;라고 하세요.
          </p>
          <p className="mt-1 text-[var(--color-mute)]">
            AI가 deployhub.yaml 을 만들어 올리면{' '}
            <Link
              href="/settings/drafts"
              className="font-medium text-[var(--color-ink)] hover:underline"
            >
              등록 초안 화면
            </Link>
            에서 승인합니다.
          </p>
        </section>

        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-xl font-medium text-[var(--color-ink)]">
            발견됨 {stacks.length}
          </h2>
          <p className="text-sm text-[var(--color-mute)]">
            관측됐지만 아직 등록되지 않은 스택입니다
          </p>
        </div>

        {stacks.length > 0 ? (
          <div className="space-y-4">
            {stacks.map((stack) => (
              <section
                key={stack.stack}
                className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-hairline)] bg-[var(--color-surface)]"
              >
                <header className="flex items-center justify-between gap-4 border-b border-[var(--color-hairline)] px-5 py-4">
                  <h3 className="font-medium text-[var(--color-ink)]">
                    {stack.stack}
                  </h3>
                  <span className="text-xs text-[var(--color-mute)]">
                    컨테이너 {stack.containers.length}
                  </span>
                </header>
                <ul className="divide-y divide-[var(--color-hairline)]">
                  {stack.containers.map((container) => (
                    <li
                      key={container.name}
                      className="grid gap-1 px-5 py-3 text-sm sm:grid-cols-[minmax(12rem,1fr)_8rem_minmax(12rem,1fr)] sm:gap-4"
                    >
                      <span className="font-medium text-[var(--color-ink)]">
                        {container.name}
                      </span>
                      <span className="text-[var(--color-body)]">
                        {container.status ?? '—'}
                      </span>
                      <span className="font-mono text-xs text-[var(--color-mute)]">
                        {container.image ?? ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : (
          <section className="rounded-[var(--radius-card)] border border-[var(--color-hairline)] bg-[var(--color-surface)] px-5 py-12 text-center">
            <p className="font-medium text-[var(--color-ink)]">
              모든 실행 중인 스택이 등록되어 있습니다
            </p>
          </section>
        )}
      </main>
    </>
  );
}
