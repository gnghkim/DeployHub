import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProjectBySlug } from '@deployhub/db';
import { Topbar } from '../../../../../components/shell/topbar';
import { Card } from '../../../../../components/ui/card';
import { db } from '../../../../../lib/db';
import { ComponentForm } from '../component-form';

export const dynamic = 'force-dynamic';

export default async function NewComponentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = await getProjectBySlug(db, slug);
  if (!project) notFound();

  return (
    <>
      <Topbar title="New Component" />
      <main className="mx-auto max-w-4xl space-y-6 p-8">
        <div>
          <Link
            href={`/projects/${project.slug}`}
            className="text-sm text-[var(--color-mute)] hover:text-[var(--color-ink)]"
          >
            ← {project.name}
          </Link>
          <h2 className="mt-4 text-xl font-medium text-[var(--color-ink)]">구성요소 등록</h2>
          <p className="mt-1 text-sm text-[var(--color-mute)]">
            기술 스택과 운영 중요도를 입력합니다.
          </p>
        </div>
        <Card>
          <ComponentForm projectId={project.id} />
        </Card>
      </main>
    </>
  );
}
