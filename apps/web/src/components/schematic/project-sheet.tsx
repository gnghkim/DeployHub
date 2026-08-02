import Image from 'next/image';
import Link from 'next/link';
import type { ProjectStatus } from '@deployhub/db';
import { Annotation } from './annotation';
import { Sheet } from './sheet';
import { ProjectSheetCollapse } from './project-sheet-collapse';
import { StatusDot } from '../ui/status-dot';
import { Badge, type Tone } from '../ui/badge';
import { formatDateTime } from '../../lib/datetime';

type SnapshotSource = 'automatic' | 'manual' | null;
type SnapshotAttemptStatus = 'pending' | 'success' | 'failed' | null;

export type ProjectSheetProject = {
  id: string;
  slug: string;
  name: string;
  repository: string | null;
  judgement: ProjectStatus;
  latestDeploymentAt: Date | null;
  latestDeploymentRelative: string | null;
  deploymentLabel: string | null;
  snapshotMode: 'disabled' | 'automatic' | 'manual';
  snapshot: {
    hasImage: boolean;
    source: SnapshotSource;
    capturedAt: Date | null;
    checksum: string | null;
    lastAttemptStatus: SnapshotAttemptStatus;
  };
  components: Array<{
    id: string;
    name: string;
    url: string | null;
  }>;
  componentObservations: ReadonlyMap<string, {
    name: string;
    state: string;
  }>;
};

function ProjectInformation({ project }: { project: ProjectSheetProject }) {
  const componentItems = project.components.map((component, index) => {
    const observation = project.componentObservations.get(component.id);
    const observedValue = observation
      ? [observation.name, observation.state].filter(Boolean).join(' · ')
      : null;
    const connector = index === project.components.length - 1 ? '└─' : '├─';

    return (
      <li key={component.id} className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
          <span
            aria-hidden="true"
            className="shrink-0 text-[var(--absent)] opacity-70"
          >
            {connector}
          </span>
          <span className="min-w-0 break-all text-[var(--line)]">
            {component.name}
          </span>
          <span className="min-w-0 max-w-full break-all">
            <Annotation value={observedValue} />
          </span>
        </div>

        {component.url ? (
          <ul className="ml-5 min-w-0">
            <li className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
              <span
                aria-hidden="true"
                className="shrink-0 text-[var(--absent)] opacity-70"
              >
                └─
              </span>
              <a
                href={component.url}
                className="min-w-0 break-all text-[var(--line-mute)] hover:underline"
              >
                {component.url}
              </a>
              <span className="min-w-0 max-w-full break-all">
                <Annotation value={null} />
              </span>
            </li>
          </ul>
        ) : null}
      </li>
    );
  });

  return (
    <div
      className="min-w-0 font-mono text-sm"
      data-testid="project-information"
    >
      <ul className="min-w-0 space-y-2">
        {project.repository ? (
          <li className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[var(--line-mute)]">
            <span className="shrink-0 text-[var(--annotation)]">github</span>
            <span className="min-w-0 break-all">{project.repository}</span>
          </li>
        ) : null}

        {project.deploymentLabel ? (
          <li className="min-w-0">
            <div className="flex min-w-0 items-baseline gap-2 text-[var(--line-mute)]">
              <span
                aria-hidden="true"
                className="shrink-0 text-[var(--absent)] opacity-70"
              >
                └─┬
              </span>
              <span className="min-w-0 break-words">
                {project.deploymentLabel}
              </span>
            </div>
            {componentItems.length > 0 ? (
              <ul className="ml-2 mt-2 min-w-0 space-y-2 sm:ml-4">
                {componentItems}
              </ul>
            ) : null}
          </li>
        ) : componentItems.length > 0 ? (
          <li className="min-w-0">
            <ul className="min-w-0 space-y-2">
              {componentItems}
            </ul>
          </li>
        ) : null}
      </ul>
    </div>
  );
}

const SNAPSHOT_STATUS_LABELS: Record<Exclude<SnapshotAttemptStatus, null>, string> = {
  pending: '갱신 중',
  success: '정상',
  failed: '실패',
};

function ProjectSnapshotPreview({ project }: { project: ProjectSheetProject }) {
  const { snapshot } = project;
  const imageEndpoint = snapshot.hasImage && snapshot.checksum
    ? `/api/projects/${encodeURIComponent(project.slug)}/snapshot?checksum=${encodeURIComponent(snapshot.checksum)}`
    : null;
  const status = snapshot.lastAttemptStatus
    ? SNAPSHOT_STATUS_LABELS[snapshot.lastAttemptStatus]
    : '시도 전';

  return (
    <section
      aria-label={`${project.name} 스냅샷`}
      className="min-w-0"
      data-testid="project-snapshot-preview"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-[var(--line)]">스냅샷</h3>
        {snapshot.lastAttemptStatus === 'pending' ? (
          <span className="rounded-full border border-[var(--rule)] px-2 py-1 text-xs text-[var(--line-mute)]">
            갱신 중
          </span>
        ) : null}
      </div>

      {imageEndpoint ? (
        <a
          href={imageEndpoint}
          target="_blank"
          rel="noreferrer"
          aria-label={`${project.name} 스냅샷 원본 새 창에서 열기`}
          className="block rounded-[var(--radius-card)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--line)]"
        >
          <div
            className="aspect-[16/10] overflow-hidden rounded-[var(--radius-card)] border border-[var(--rule)] bg-[var(--canvas)]"
            data-testid="snapshot-frame"
          >
            <Image
              src={imageEndpoint}
              alt={`${project.name} 현재 스냅샷`}
              width={1440}
              height={900}
              sizes="(min-width: 1024px) 42vw, 100vw"
              loading="lazy"
              className="h-full w-full object-contain"
              unoptimized
            />
          </div>
        </a>
      ) : (
        <div className="flex aspect-[16/10] flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-[var(--rule)] bg-[var(--canvas)] p-5 text-center">
          <p className="text-sm text-[var(--annotation)]">
            등록된 스냅샷이 없습니다.
          </p>
          <Link
            href={`/projects/${project.slug}/edit`}
            className="mt-2 text-sm font-medium text-[var(--line-mute)] underline underline-offset-2 hover:text-[var(--line)]"
          >
            스냅샷 설정
          </Link>
        </div>
      )}

      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs text-[var(--annotation)]">
        <dt>출처</dt>
        <dd className="min-w-0 text-[var(--line-mute)]">
          {snapshot.source === 'automatic'
            ? '자동 캡처'
            : snapshot.source === 'manual'
              ? '수동 업로드'
              : '없음'}
        </dd>
        <dt>캡처 시각</dt>
        <dd className="min-w-0 text-[var(--line-mute)]">
          {snapshot.capturedAt ? (
            <time
              dateTime={snapshot.capturedAt.toISOString()}
              title={formatDateTime(snapshot.capturedAt)}
            >
              {formatDateTime(snapshot.capturedAt)}
            </time>
          ) : '없음'}
        </dd>
        <dt>상태</dt>
        <dd className={snapshot.lastAttemptStatus === 'failed'
          ? 'min-w-0 text-[var(--fault)]'
          : 'min-w-0 text-[var(--line-mute)]'}
        >
          {status}
        </dd>
      </dl>
    </section>
  );
}

export function ProjectSheet({
  project,
  tone,
}: {
  project: ProjectSheetProject;
  tone: Tone;
}) {
  return (
    <Sheet className="min-w-0 overflow-hidden transition-colors duration-300 hover:border-[var(--annotation)] hover:bg-white/[0.02] focus-within:border-[var(--annotation)] focus-within:bg-white/[0.02] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]">
      <ProjectSheetCollapse
        projectId={project.id}
        projectName={project.name}
        header={(
          <>
            <StatusDot tone={tone} />
            <Link
              href={`/projects/${project.slug}`}
              className="min-w-0 break-words text-base font-semibold text-[var(--line)] transition-colors hover:text-white hover:underline focus-visible:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--line)]"
            >
              {project.name}
            </Link>
            <Badge tone={tone}>{project.judgement}</Badge>
          </>
        )}
        trailing={project.latestDeploymentAt && project.latestDeploymentRelative ? (
          <time
            className="shrink-0 text-[13px] text-[var(--absent)]"
            dateTime={project.latestDeploymentAt.toISOString()}
            title={formatDateTime(project.latestDeploymentAt)}
          >
            {project.latestDeploymentRelative}
          </time>
        ) : null}
      >
        <div
          className="mt-4 grid min-w-0 gap-5 border-t border-[var(--rule)] pt-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,42%)]"
          data-testid="project-card-body"
        >
          <ProjectInformation project={project} />
          <ProjectSnapshotPreview project={project} />
        </div>
      </ProjectSheetCollapse>
    </Sheet>
  );
}
