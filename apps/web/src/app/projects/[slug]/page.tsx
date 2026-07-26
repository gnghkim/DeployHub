import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProjectBySlug, listProjectResources } from '@deployhub/db';
import { deleteComponent } from '../../../actions/components';
import { archiveProject } from '../../../actions/projects';
import { Topbar } from '../../../components/shell/topbar';
import { Badge, type Tone } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { db } from '../../../lib/db';
import { ProjectForm } from '../project-form';
import { ComponentForm } from './components/component-form';

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
  const linkedResources = await listProjectResources(db, project.id);

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
            <div className="flex items-center gap-3">
              <h3 className="text-base font-medium text-[var(--color-ink)]">구성요소</h3>
              <span className="text-xs text-[var(--color-mute)]">{project.components.length}개</span>
            </div>
            <Link
              href={`/projects/${project.slug}/components/new`}
              className="inline-flex h-9 items-center rounded-[var(--radius-button)] border border-[var(--color-hairline)] bg-[var(--color-surface-elevated)] px-3 text-sm font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-card)]"
            >
              구성요소 추가
            </Link>
          </div>
          {project.components.length ? (
            <>
              <Table className="mt-4">
                <TableHeader>
                  <TableRow>
                    <TableHead>이름</TableHead>
                    <TableHead>타입</TableHead>
                    <TableHead>Framework</TableHead>
                    <TableHead>Runtime</TableHead>
                    <TableHead>Language</TableHead>
                    <TableHead>중요도</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {project.components.map((component) => (
                    <TableRow key={component.id}>
                      <TableCell className="font-medium text-[var(--color-ink)]">
                        {component.name}
                      </TableCell>
                      <TableCell>{component.componentType}</TableCell>
                      <TableCell>{component.framework ?? '—'}</TableCell>
                      <TableCell>{component.runtime ?? '—'}</TableCell>
                      <TableCell>{component.language ?? '—'}</TableCell>
                      <TableCell>{component.criticality}/5</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="mt-6 space-y-3">
                {project.components.map((component) => {
                  const deleteAction = deleteComponent.bind(null, component.id);
                  return (
                    <details
                      key={component.id}
                      className="rounded-[var(--radius-card)] border border-[var(--color-hairline)] px-4 py-3"
                    >
                      <summary className="cursor-pointer text-sm font-medium text-[var(--color-ink)]">
                        {component.name} 수정
                      </summary>
                      <div className="mt-5">
                        <ComponentForm projectId={project.id} component={component} />
                        <form action={deleteAction} className="mt-3">
                          <Button type="submit" variant="tertiary">구성요소 삭제</Button>
                        </form>
                      </div>
                    </details>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="mt-4 text-sm text-[var(--color-mute)]">
              아직 등록된 구성요소가 없습니다.
            </p>
          )}
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <h3 className="text-base font-medium text-[var(--color-ink)]">
              연결된 자원
            </h3>
            <span className="text-xs text-[var(--color-mute)]">
              {linkedResources.length}개
            </span>
          </div>
          {linkedResources.length > 0 ? (
            <Table className="mt-4">
              <TableHeader>
                <TableRow>
                  <TableHead>자원</TableHead>
                  <TableHead>타입</TableHead>
                  <TableHead>구성요소</TableHead>
                  <TableHead>환경</TableHead>
                  <TableHead>연결 근거</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linkedResources.map((resource) => (
                  <TableRow key={resource.linkId}>
                    <TableCell className="font-medium text-[var(--color-ink)]">
                      {resource.externalId}
                    </TableCell>
                    <TableCell>{resource.resourceType}</TableCell>
                    <TableCell>{resource.componentName}</TableCell>
                    <TableCell>{resource.environment}</TableCell>
                    <TableCell>
                      <Badge>{resource.linkedBy}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="mt-4 text-sm text-[var(--color-mute)]">
              아직 연결된 자원이 없습니다.
            </p>
          )}
        </Card>
      </main>
    </>
  );
}
