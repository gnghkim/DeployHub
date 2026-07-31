import Link from 'next/link';
import type { ProjectStatus } from '@deployhub/db';
import { Annotation } from './annotation';
import { Sheet } from './sheet';
import { StatusDot } from '../ui/status-dot';
import { Badge, type Tone } from '../ui/badge';
import { formatDateTime } from '../../lib/datetime';

export type ProjectSheetProject = {
  id: string;
  slug: string;
  name: string;
  repository: string | null;
  judgement: ProjectStatus;
  latestDeploymentAt: Date | null;
  latestDeploymentRelative: string | null;
  deploymentLabel: string | null;
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

export function ProjectSheet({
  project,
  tone,
}: {
  project: ProjectSheetProject;
  tone: Tone;
}) {
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
            className="shrink-0 text-[var(--absent)]"
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
                className="shrink-0 text-[var(--absent)]"
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
    <Sheet className="min-w-0 overflow-hidden">
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-2">
          <StatusDot tone={tone} />
          <Link
            href={`/projects/${project.slug}`}
            className="min-w-0 break-words text-[15px] font-medium text-[var(--line)] hover:underline"
          >
            {project.name}
          </Link>
          <Badge tone={tone}>{project.judgement}</Badge>
        </div>

        {project.latestDeploymentAt && project.latestDeploymentRelative ? (
          <time
            className="shrink-0 text-xs text-[var(--absent)]"
            dateTime={project.latestDeploymentAt.toISOString()}
            title={formatDateTime(project.latestDeploymentAt)}
          >
            {project.latestDeploymentRelative}
          </time>
        ) : null}
      </header>

      <div className="mt-4 min-w-0 border-t border-[var(--rule)] pt-4 font-mono text-[13px]">
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
                  className="shrink-0 text-[var(--absent)]"
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
    </Sheet>
  );
}
