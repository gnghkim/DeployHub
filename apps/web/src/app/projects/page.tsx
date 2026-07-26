import Link from 'next/link';
import { listProjects } from '@deployhub/db';
import { Topbar } from '../../components/shell/topbar';
import { Badge, type Tone } from '../../components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { db } from '../../lib/db';

export const dynamic = 'force-dynamic';

const STATUS_TONES: Record<string, Tone> = {
  active: 'success',
  paused: 'warning',
  maintenance: 'warning',
  archived: 'neutral',
};

const DATE_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export default async function ProjectsPage() {
  const projects = await listProjects(db);

  return (
    <>
      <Topbar title="Projects" />
      <main className="space-y-6 p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-medium text-[var(--color-ink)]">프로젝트</h2>
            <p className="mt-1 text-sm text-[var(--color-mute)]">
              서비스의 상태와 저장소 연결을 한곳에서 관리합니다.
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
                <TableHead>상태</TableHead>
                <TableHead>Lifecycle</TableHead>
                <TableHead>저장소</TableHead>
                <TableHead>최근 변경</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((project) => (
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
                  <TableCell className="text-[var(--color-mute)]">—</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONES[project.status] ?? 'neutral'}>{project.status}</Badge>
                  </TableCell>
                  <TableCell>{project.lifecycle}</TableCell>
                  <TableCell>{project.repository ?? '—'}</TableCell>
                  <TableCell>
                    <time dateTime={project.updatedAt.toISOString()}>
                      {DATE_FORMAT.format(project.updatedAt)}
                    </time>
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
