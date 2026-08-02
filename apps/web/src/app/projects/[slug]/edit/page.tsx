import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProjectBySlug } from '@deployhub/db';
import { archiveProject } from '../../../../actions/projects';
import { deleteComponent } from '../../../../actions/components';
import { Topbar } from '../../../../components/shell/topbar';
import { Button } from '../../../../components/ui/button';
import { Card } from '../../../../components/ui/card';
import { db } from '../../../../lib/db';
import { ProjectForm } from '../../project-form';
import { ComponentForm } from '../components/component-form';
import { SnapshotSettingsForm } from '../snapshot-settings-form';

export const dynamic = 'force-dynamic';

export default async function EditProjectPage({
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
      <Topbar title={`${project.name} 편집`} />
      <main className="space-y-6 p-4 md:p-8">
        <div>
          <Link
            href={`/projects/${project.slug}`}
            className="text-sm text-[var(--annotation)] hover:text-[var(--line)]"
          >
            ← 프로젝트 상세
          </Link>
          <h2 className="mt-4 text-xl font-medium text-[var(--line)]">
            {project.name} 편집
          </h2>
        </div>

        <Card>
          <h3 className="mb-5 text-base font-medium text-[var(--line)]">
            프로젝트
          </h3>
          <ProjectForm project={project} />
        </Card>

        <Card>
          <h3 className="mb-5 text-base font-medium text-[var(--line)]">
            스냅샷 설정
          </h3>
          <SnapshotSettingsForm
            slug={project.slug}
            mode={project.snapshotMode}
            snapshotUrl={project.snapshotUrl}
          />
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h3 className="text-base font-medium text-[var(--line)]">
                구성요소
              </h3>
              <span className="text-xs text-[var(--annotation)]">
                {project.components.length}개
              </span>
            </div>
            <Link
              href={`/projects/${project.slug}/components/new`}
              className="inline-flex h-9 items-center rounded-[var(--radius-button)] border border-[var(--rule)] bg-[var(--paper)] px-3 text-sm font-medium text-[var(--line)] transition-colors hover:bg-white/[0.02]"
            >
              구성요소 추가
            </Link>
          </div>

          {project.components.length > 0 ? (
            <div className="mt-5 space-y-3">
              {project.components.map((component) => {
                const deleteAction = deleteComponent.bind(null, component.id);
                return (
                  <details
                    key={component.id}
                    className="rounded-[var(--radius-card)] border border-[var(--rule)] px-4 py-3"
                  >
                    <summary className="cursor-pointer text-sm font-medium text-[var(--line)]">
                      {component.name} 수정
                    </summary>
                    <div className="mt-5">
                      <ComponentForm
                        projectId={project.id}
                        component={component}
                      />
                      <form action={deleteAction} className="mt-3">
                        <Button type="submit" variant="tertiary">
                          구성요소 삭제
                        </Button>
                      </form>
                    </div>
                  </details>
                );
              })}
            </div>
          ) : (
            <p className="mt-5 text-sm text-[var(--annotation)]">
              아직 등록된 구성요소가 없습니다.
            </p>
          )}
        </Card>

        <Card>
          <h3 className="text-base font-medium text-[var(--line)]">
            프로젝트 보관
          </h3>
          <p className="mt-1 text-sm text-[var(--annotation)]">
            보관한 프로젝트는 기본 프로젝트 목록에서 제외됩니다.
          </p>
          <form action={archiveAction} className="mt-4">
            <Button type="submit" variant="tertiary">보관</Button>
          </form>
        </Card>
      </main>
    </>
  );
}
