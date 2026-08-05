import Link from 'next/link';
import {
  countDiscoveredStacks,
  listProjectsWithSummaryData,
  type ProjectStatus,
} from '@deployhub/db';
import { ProjectOrderList } from '@/components/schematic/project-order-list';
import { ProjectSheet } from '@/components/schematic/project-sheet';
import { Topbar } from '@/components/shell/topbar';
import type { Tone } from '@/components/ui/badge';
import { db } from '@/lib/db';
import {
  formatRelativeTime,
  summarizeBackend,
} from '@/lib/backend-view';

export const dynamic = 'force-dynamic';

const STATUS_TONES: Record<ProjectStatus, Tone> = {
  정상: 'neutral',
  미확인: 'neutral',
  주의: 'caution',
  장애: 'fault',
};

export default async function Home() {
  // 상대 시각은 서버에서 한 번만 계산한다. 클라이언트가 다시 계산하면
  // 서버 렌더 결과와 달라져 hydration 이 어긋난다.
  const renderedAt = new Date();
  const [projects, discoveredCount] = await Promise.all([
    listProjectsWithSummaryData(db),
    countDiscoveredStacks(db),
  ]);
  const rows = projects.map((project) => {
    const declaredProviders = project.components.map(
      (component) => component.provider,
    );
    const hasDeploymentData = project.observedProviders.length > 0
      || declaredProviders.some((provider) => provider?.trim());

    return {
      ...project,
      latestDeploymentRelative: project.latestDeploymentAt
        ? formatRelativeTime(project.latestDeploymentAt, renderedAt)
        : null,
      deploymentLabel: hasDeploymentData
        ? summarizeBackend({
            observedProviders: project.observedProviders,
            declaredProviders,
          })
        : null,
    };
  });

  return (
    <>
      <Topbar title="프로젝트" />
      <main className="space-y-6 p-4 md:p-8">
        <h2 className="text-xl font-medium text-[var(--line)]">
          프로젝트 {projects.length}
        </h2>

        {rows.length > 0 ? (
          <ProjectOrderList
            items={rows.map((project) => ({
              id: project.id,
              name: project.name,
              node: (
                <ProjectSheet
                  project={project}
                  tone={STATUS_TONES[project.judgement]}
                />
              ),
            }))}
          />
        ) : (
          <section className="rounded-[var(--radius-card)] border border-[var(--rule)] bg-[var(--paper)] px-5 py-12 text-center text-sm">
            <p className="font-medium text-[var(--line)]">
              아직 등록된 프로젝트가 없습니다.
            </p>
            <p className="mt-3 text-[var(--annotation)]">
              각 프로젝트를 작업 중인 AI에게 &quot;DeployHub에 등록해줘&quot;라고 하면
            </p>
            <p className="mt-1 text-[var(--annotation)]">
              deployhub.yaml 을 만들어 올립니다. 올라온 초안은{' '}
              <Link
                href="/settings/drafts"
                className="font-medium text-[var(--line)] hover:underline"
              >
                등록 초안 화면
              </Link>
              에서 승인합니다.
            </p>
          </section>
        )}

        <p className="border-t border-[var(--rule)] pt-4 text-sm text-[var(--annotation)]">
          등록되지 않은 스택 {discoveredCount} →{' '}
          <Link
            href="/discovered"
            className="text-[var(--line)] hover:underline"
          >
            발견
          </Link>
        </p>
      </main>
    </>
  );
}
