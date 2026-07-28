import Link from 'next/link';
import {
  listProjectsWithSummaryData,
  type ProjectStatus,
} from '@deployhub/db';
import { Topbar } from '@/components/shell/topbar';
import { Badge, type Tone } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { db } from '@/lib/db';
import { formatRelativeTime } from '@/lib/backend-view';
import { summarizeProject } from '@/lib/project-summary';

export const dynamic = 'force-dynamic';

const DATE_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const STATUS_TONES: Record<ProjectStatus, Tone> = {
  정상: 'neutral',
  미확인: 'neutral',
  주의: 'warning',
  장애: 'error',
};

export default async function Home() {
  // 상대 시각은 서버에서 한 번만 계산한다. 클라이언트가 다시 계산하면
  // 서버 렌더 결과와 달라져 hydration 이 어긋난다. 절대 시각은 title 에 둔다.
  const renderedAt = new Date();
  const projects = await listProjectsWithSummaryData(db);
  const rows = projects.map((project) => ({
    ...project,
    latestDeploymentRelative: project.latestDeploymentAt
      ? formatRelativeTime(project.latestDeploymentAt, renderedAt)
      : null,
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
      <Topbar title="프로젝트" />
      <main className="space-y-6 p-4 md:p-8">
        <h2 className="text-xl font-medium text-[var(--color-ink)]">
          프로젝트 {projects.length}
        </h2>

        <section className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-hairline)] bg-[var(--color-surface)]">
          {rows.length > 0 ? (
            <div className="md:hidden">
              <ul className="divide-y divide-[var(--color-hairline)]">
                {rows.map((project) => (
                  <li key={project.id} className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <Link
                          href={`/projects/${project.slug}`}
                          className="font-medium text-[var(--color-ink)] hover:underline"
                        >
                          {project.name}
                        </Link>
                        <p className="mt-0.5 truncate text-xs text-[var(--color-mute)]">
                          {project.slug}
                        </p>
                      </div>
                      {project.latestDeploymentAt ? (
                        <time
                          className="shrink-0 text-xs text-[var(--color-mute)]"
                          dateTime={project.latestDeploymentAt.toISOString()}
                          title={DATE_FORMAT.format(project.latestDeploymentAt)}
                        >
                          {project.latestDeploymentRelative}
                        </time>
                      ) : (
                        <span className="shrink-0 text-xs text-[var(--color-mute)]">
                          —
                        </span>
                      )}
                    </div>
                    <dl className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                      <dt className="text-[var(--color-mute)]">판정</dt>
                      <dd>
                        <Badge tone={STATUS_TONES[project.judgement]}>
                          {project.judgement}
                        </Badge>
                      </dd>
                      <dt className="text-[var(--color-mute)]">구성</dt>
                      <dd className="text-[var(--color-body)]">
                        {project.summary.stack}
                      </dd>
                      <dt className="text-[var(--color-mute)]">배포</dt>
                      <dd className="text-[var(--color-body)]">
                        {project.summary.deployment}
                      </dd>
                      <dt className="text-[var(--color-mute)]">DB</dt>
                      <dd className="text-[var(--color-body)]">
                        {project.summary.database}
                      </dd>
                    </dl>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>판정</TableHead>
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
                      <Badge tone={STATUS_TONES[project.judgement]}>
                        {project.judgement}
                      </Badge>
                    </TableCell>
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
                        <time
                          dateTime={project.latestDeploymentAt.toISOString()}
                          title={DATE_FORMAT.format(project.latestDeploymentAt)}
                        >
                          {project.latestDeploymentRelative}
                        </time>
                      ) : (
                        <>—</>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {projects.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm">
              <p className="font-medium text-[var(--color-ink)]">
                아직 등록된 프로젝트가 없습니다.
              </p>
              <p className="mt-3 text-[var(--color-mute)]">
                각 프로젝트를 작업 중인 AI에게 &quot;DeployHub에 등록해줘&quot;라고 하면
              </p>
              <p className="mt-1 text-[var(--color-mute)]">
                deployhub.yaml 을 만들어 올립니다. 올라온 초안은{' '}
                <Link
                  href="/settings/drafts"
                  className="font-medium text-[var(--color-ink)] hover:underline"
                >
                  등록 초안 화면
                </Link>
                에서 승인합니다.
              </p>
            </div>
          ) : null}
        </section>
      </main>
    </>
  );
}
