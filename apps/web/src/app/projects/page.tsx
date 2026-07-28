import Link from 'next/link';
import { listProjectsWithSummaryData } from '@deployhub/db';
import { Topbar } from '../../components/shell/topbar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { db } from '../../lib/db';
import { summarizeProject } from '../../lib/project-summary';

export const dynamic = 'force-dynamic';

const DATE_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export default async function ProjectsPage() {
  const projects = await listProjectsWithSummaryData(db);
  const rows = projects.map((project) => ({
    ...project,
    summary: summarizeProject({
      components: project.components.map((component) => ({
        type: component.componentType,
        framework: component.framework,
        runtime: component.runtime,
        provider: component.provider,
      })),
      observedProviders: project.observedProviders,
    }),
  }));

  return (
    <>
      <Topbar title="Projects" />
      <main className="space-y-6 p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-medium text-[var(--color-ink)]">프로젝트</h2>
            <p className="mt-1 text-sm text-[var(--color-mute)]">
              각 프로젝트의 구성과 실제 배포 기반을 한눈에 확인합니다.
            </p>
          </div>
          <Link
            href="/projects/new"
            className="inline-flex h-9 items-center rounded-[var(--radius-button)] border border-[var(--color-ink)] bg-[var(--color-ink)] px-3 text-sm font-medium text-[var(--color-canvas)] transition-colors hover:bg-[var(--color-body)]"
          >
            새 프로젝트
          </Link>
        </div>

        <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>프로젝트</TableHead>
                <TableHead>구성</TableHead>
                <TableHead>배포</TableHead>
                <TableHead>DB</TableHead>
                <TableHead>최근 배포</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((project) => (
                <TableRow key={project.id}>
                  <TableCell>
                    <Link
                      href={`/projects/${project.slug}`}
                      className="font-medium text-[var(--color-ink)] hover:underline"
                    >
                      {project.name}
                    </Link>
                    <p className="mt-0.5 text-xs text-[var(--color-mute)]">{project.slug}</p>
                  </TableCell>
                  <TableCell>{project.summary.stack}</TableCell>
                  <TableCell>{project.summary.deployment}</TableCell>
                  <TableCell>{project.summary.database}</TableCell>
                  <TableCell>
                    {project.latestDeploymentAt ? (
                      <time dateTime={project.latestDeploymentAt.toISOString()}>
                        {DATE_FORMAT.format(project.latestDeploymentAt)}
                      </time>
                    ) : (
                      <>—</>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {projects.length === 0 ? (
            <p className="px-5 py-12 text-center text-sm text-[var(--color-mute)]">
              등록된 프로젝트가 없습니다.
            </p>
          ) : null}
        </section>
      </main>
    </>
  );
}
