import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProjectBySlug } from '@deployhub/db';
import { archiveProject } from '../../../actions/projects';
import { Topbar } from '../../../components/shell/topbar';
import { Badge, type Tone } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { db } from '../../../lib/db';
import { ProjectForm } from '../project-form';

export const dynamic = 'force-dynamic';

const STATUS_TONES: Record<string, Tone> = {
  active: 'success',
  paused: 'warning',
  maintenance: 'warning',
  archived: 'neutral',
};

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = await getProjectBySlug(db, slug);
  if (!project) notFound();

  const archiveAction = archiveProject.bind(null, project.id);

  return (
    <>
      <Topbar title={project.name} />
      <main className="space-y-6 p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link href="/projects" className="text-sm text-[var(--color-mute)] hover:text-[var(--color-ink)]">
              ← 프로젝트 목록
            </Link>
            <div className="mt-4 flex items-center gap-3">
              <h2 className="text-xl font-medium text-[var(--color-ink)]">{project.name}</h2>
              <Badge tone={STATUS_TONES[project.status] ?? 'neutral'}>{project.status}</Badge>
            </div>
            <p className="mt-1 text-sm text-[var(--color-mute)]">
              {project.description ?? '설명이 없습니다.'}
            </p>
          </div>
          <form action={archiveAction}>
            <Button type="submit" variant="tertiary">보관</Button>
          </form>
        </div>

        <Card>
          <h3 className="mb-5 text-base font-medium text-[var(--color-ink)]">Overview</h3>
          <ProjectForm project={project} />
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <h3 className="text-base font-medium text-[var(--color-ink)]">구성요소</h3>
            <span className="text-xs text-[var(--color-mute)]">{project.components.length}개</span>
          </div>
          {project.components.length ? (
            <ul className="mt-4 divide-y divide-[var(--color-hairline)]">
              {project.components.map((component) => (
                <li key={component.id} className="flex items-center justify-between py-3 text-sm">
                  <span className="font-medium text-[var(--color-ink)]">{component.name}</span>
                  <span className="text-[var(--color-mute)]">{component.componentType}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-[var(--color-mute)]">
              아직 연결된 구성요소가 없습니다.
            </p>
          )}
        </Card>
      </main>
    </>
  );
}
