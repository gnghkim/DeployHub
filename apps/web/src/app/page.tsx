import { auth } from '@/auth/config';
import { Topbar } from '@/components/shell/topbar';
import { Card } from '@/components/ui/card';

export default async function Home() {
  const session = await auth();
  return (
    <>
      <Topbar title="Overview" />
      <main className="space-y-6 p-8">
        <section>
          <h2 className="text-xl font-medium text-[var(--color-ink)]">Workspace</h2>
          <p className="mt-1 text-sm text-[var(--color-mute)]">
            프로젝트와 인프라 상태를 한곳에서 확인합니다.
          </p>
        </section>
        <Card>
          <p className="text-sm text-[var(--color-mute)]">Signed in as</p>
          <p className="mt-1 font-medium text-[var(--color-ink)]">
            {session?.user?.name ?? '인증되지 않음'}
          </p>
        </Card>
      </main>
    </>
  );
}
