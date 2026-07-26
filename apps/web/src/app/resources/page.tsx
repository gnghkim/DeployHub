import Link from 'next/link';
import {
  getProjectBySlug,
  listProjects,
  listResources,
} from '@deployhub/db';
import { Topbar } from '../../components/shell/topbar';
import { Badge, type Tone } from '../../components/ui/badge';
import { Card } from '../../components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table';
import { db } from '../../lib/db';
import { suggestMatches } from '../../lib/matcher';
import { githubResourceDetails } from '../../lib/resource-view';
import { SuggestionForm } from './suggestion-form';

export const dynamic = 'force-dynamic';

const DATE_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const WORKFLOW_TONES: Record<string, Tone> = {
  success: 'success',
  failure: 'error',
  cancelled: 'neutral',
  skipped: 'neutral',
};

function displayDate(value: string | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : DATE_FORMAT.format(date);
}

export default async function ResourcesPage() {
  const [resources, projects] = await Promise.all([
    listResources(db),
    listProjects(db),
  ]);
  const projectDetails = await Promise.all(
    projects.map((project) => getProjectBySlug(db, project.slug)),
  );
  const unlinkedResources = resources.filter(
    (resource) => resource.links.length === 0,
  );
  const repositories = resources.filter(
    (resource) => resource.resourceType === 'github_repository',
  );
  const suggestions = suggestMatches(
    unlinkedResources
      .filter((resource) => resource.resourceType === 'github_repository')
      .map((resource) => ({
        id: resource.id,
        externalId: resource.externalId,
        name: resource.name,
      })),
    projects.map((project) => ({
      id: project.id,
      slug: project.slug,
      repository: project.repository,
    })),
  );

  return (
    <>
      <Topbar title="Resources" />
      <main className="space-y-6 p-8">
        <div>
          <h2 className="text-xl font-medium text-[var(--color-ink)]">
            저장소 기준 그룹핑
          </h2>
          <p className="mt-1 text-sm text-[var(--color-mute)]">
            정확히 일치한 후보만 표시하며, 구성요소를 고르고 확인해야 연결됩니다.
          </p>
        </div>

        <Card>
          <div className="flex items-center gap-3">
            <h3 className="text-base font-medium text-[var(--color-ink)]">
              수집된 저장소
            </h3>
            <span className="text-xs text-[var(--color-mute)]">
              {repositories.length}개
            </span>
          </div>
          {repositories.length > 0 ? (
            <Table className="mt-4">
              <TableHeader>
                <TableRow>
                  <TableHead>저장소</TableHead>
                  <TableHead>마지막 커밋</TableHead>
                  <TableHead>워크플로</TableHead>
                  <TableHead>연결된 프로젝트</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {repositories.map((resource) => {
                  const details = githubResourceDetails(resource.metadata);
                  const workflow = details.lastWorkflowRun;
                  return (
                    <TableRow key={resource.id}>
                      <TableCell>
                        {resource.url ? (
                          <a
                            href={resource.url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-[var(--color-ink)] hover:underline"
                          >
                            {resource.externalId}
                          </a>
                        ) : (
                          <span className="font-medium text-[var(--color-ink)]">
                            {resource.externalId}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {details.lastCommit ? (
                          <div>
                            <p className="font-mono text-xs text-[var(--color-ink)]">
                              {details.lastCommit.sha.slice(0, 7)}
                            </p>
                            <p className="mt-1 text-xs text-[var(--color-mute)]">
                              {displayDate(details.lastCommit.committedAt)}
                            </p>
                          </div>
                        ) : '—'}
                      </TableCell>
                      <TableCell>
                        {workflow ? (
                          <div className="flex items-center gap-2">
                            <Badge
                              tone={
                                WORKFLOW_TONES[workflow.conclusion ?? '']
                                ?? 'neutral'
                              }
                            >
                              {workflow.conclusion ?? '진행 중'}
                            </Badge>
                            <span className="text-xs text-[var(--color-mute)]">
                              {workflow.name ?? 'Workflow'}
                            </span>
                          </div>
                        ) : '—'}
                      </TableCell>
                      <TableCell>
                        {resource.links.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {resource.links.map((link) => (
                              <Link
                                key={link.linkId}
                                href={`/projects/${link.projectSlug}`}
                                className="text-sm text-[var(--color-info)] hover:underline"
                              >
                                {link.projectName} / {link.componentName}
                              </Link>
                            ))}
                          </div>
                        ) : (
                          <Badge>Unlinked</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="mt-4 text-sm text-[var(--color-mute)]">
              수집된 저장소가 없습니다.
            </p>
          )}
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <h3 className="text-base font-medium text-[var(--color-ink)]">
              연결 제안
            </h3>
            <span className="text-xs text-[var(--color-mute)]">
              {suggestions.length}개
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {suggestions.map((suggestion) => {
              const project = projectDetails.find(
                (candidate) => candidate?.id === suggestion.projectId,
              );
              return (
                <div
                  key={suggestion.resourceId}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-card)] border border-[var(--color-hairline)] p-4"
                >
                  <div>
                    <p className="font-medium text-[var(--color-ink)]">
                      {suggestion.externalId}
                      <span className="mx-2 text-[var(--color-ash)]">→</span>
                      {suggestion.projectSlug}
                    </p>
                    <div className="mt-2">
                      <Badge tone={suggestion.basis === 'repository' ? 'info' : 'warning'}>
                        근거: {suggestion.basis}
                      </Badge>
                    </div>
                  </div>
                  <SuggestionForm
                    resourceId={suggestion.resourceId}
                    projectSlug={suggestion.projectSlug}
                    components={project?.components ?? []}
                  />
                </div>
              );
            })}
            {suggestions.length === 0 ? (
              <p className="text-sm text-[var(--color-mute)]">
                확인할 연결 제안이 없습니다.
              </p>
            ) : null}
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <h3 className="text-base font-medium text-[var(--color-ink)]">
              미연결 자원
            </h3>
            <Badge>{unlinkedResources.length} Unlinked</Badge>
          </div>
          <ul className="mt-4 divide-y divide-[var(--color-hairline)]">
            {unlinkedResources.map((resource) => (
              <li
                key={resource.id}
                className="flex items-center justify-between gap-3 py-3 text-sm"
              >
                <span className="text-[var(--color-ink)]">
                  {resource.externalId}
                </span>
                <Badge>Unlinked</Badge>
              </li>
            ))}
          </ul>
          {unlinkedResources.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--color-mute)]">
              모든 자원이 연결되어 있습니다.
            </p>
          ) : null}
        </Card>
      </main>
    </>
  );
}
