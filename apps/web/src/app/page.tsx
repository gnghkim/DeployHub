import { auth } from '@/auth/config';
import { Topbar } from '@/components/shell/topbar';
import { Card } from '@/components/ui/card';
import {
  computeDrift,
  listProjects,
  listResources,
} from '@deployhub/db';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const [session, projects, resources] = await Promise.all([
    auth(),
    listProjects(db),
    listResources(db),
  ]);
  const repositoryCount = resources.filter(
    (resource) => resource.resourceType === 'github_repository',
  ).length;
  const unlinkedCount = resources.filter(
    (resource) => resource.links.length === 0,
  ).length;
  const runningContainerCount = resources.filter(
    (resource) => (
      resource.resourceType === 'docker_container'
      && resource.status === 'running'
    ),
  ).length;
  const driftByProject = await Promise.all(
    projects.map((project) => computeDrift(db, project.id)),
  );
  const projectsWithDrift = driftByProject.filter(
    (projectDrift) => projectDrift.length > 0,
  ).length;
  const summaries = [
    { label: '전체 프로젝트', value: projects.length },
    { label: '수집 저장소', value: repositoryCount },
    { label: '실행 중 컨테이너', value: runningContainerCount },
    { label: '미연결 자원', value: unlinkedCount },
    { label: 'Drift 있는 프로젝트', value: projectsWithDrift },
  ];

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
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {summaries.map((summary) => (
            <Card key={summary.label}>
              <p className="text-sm text-[var(--color-mute)]">
                {summary.label}
              </p>
              <p className="mt-2 text-2xl font-medium text-[var(--color-ink)]">
                {summary.value}
              </p>
            </Card>
          ))}
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
