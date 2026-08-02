import Link from 'next/link';
import type { ProjectStatus } from '@deployhub/db';
import { Annotation } from './annotation';
import { Sheet } from './sheet';
import { ProjectSheetCollapse } from './project-sheet-collapse';
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
        <div className="mt-4 min-w-0 border-t border-[var(--rule)] pt-4 font-mono text-sm">
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
      </ProjectSheetCollapse>
    </Sheet>
  );
}
