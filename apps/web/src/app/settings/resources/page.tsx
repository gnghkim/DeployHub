import Link from 'next/link';
import {
  getProjectBySlug,
  listProjects,
  listResources,
} from '@deployhub/db';
import { Topbar } from '../../../components/shell/topbar';
import { Badge } from '../../../components/ui/badge';
import { Card } from '../../../components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { removeResourceLink } from '../../../actions/links';
import { Button } from '../../../components/ui/button';
import { db } from '../../../lib/db';
import { shortContainerId } from '../../../lib/backend-view';
import { suggestMatches } from '../../../lib/matcher';
import { githubResourceDetails } from '../../../lib/resource-view';
import { SuggestionForm } from './suggestion-form';

export const dynamic = 'force-dynamic';

const DATE_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function displayDate(value: string | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : DATE_FORMAT.format(date);
}

function metadataString(metadata: unknown, key: string): string | null {
  if (
    typeof metadata !== 'object'
    || metadata === null
    || Array.isArray(metadata)
  ) {
    return null;
  }
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

export default async function ResourcesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [resources, projects, filters] = await Promise.all([
    listResources(db),
    listProjects(db),
    searchParams,
  ]);
  const provider = typeof filters.provider === 'string'
    ? filters.provider
    : '';
  const resourceType = typeof filters.resourceType === 'string'
    ? filters.resourceType
    : '';
  const filteredResources = resources.filter((resource) => (
    (provider === '' || resource.provider === provider)
    && (
      resourceType === ''
      || resource.resourceType === resourceType
    )
  ));
  const providers = [...new Set(
    resources.map((resource) => resource.provider),
  )].sort();
  const resourceTypes = [...new Set(
    resources.map((resource) => resource.resourceType),
  )].sort();
  const projectDetails = await Promise.all(
    projects.map((project) => getProjectBySlug(db, project.slug)),
  );
  const componentOptions = projectDetails.flatMap((project) => (
    project
      ? project.components.map((component) => ({
        id: component.id,
        name: `${project.name} / ${component.name}`,
      }))
      : []
  ));
  const unlinkedResources = filteredResources.filter(
    (resource) => resource.links.length === 0,
  );
  const repositories = resources.filter(
    (resource) => resource.resourceType === 'github_repository',
  );
  const suggestions = suggestMatches(
    repositories
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
            관측 자원
          </h2>
          <p className="mt-1 text-sm text-[var(--color-mute)]">
            서버에서 관측한 자원을 연결 여부와 관계없이 모두 표시합니다.
          </p>
        </div>

        <Card>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex items-center gap-3">
              <h3 className="text-base font-medium text-[var(--color-ink)]">
                수집된 자원
              </h3>
              <span className="text-xs text-[var(--color-mute)]">
                {filteredResources.length}개 / 전체 {resources.length}개
              </span>
            </div>
            <form className="flex flex-wrap items-end gap-3">
              <label className="text-xs text-[var(--color-mute)]">
                Provider
                <select
                  name="provider"
                  defaultValue={provider}
                  className="mt-1 block h-9 rounded-[var(--radius-button)] border border-[var(--color-hairline)] bg-[var(--color-surface-elevated)] px-3 text-sm text-[var(--color-ink)]"
                >
                  <option value="">전체</option>
                  {providers.map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-[var(--color-mute)]">
                Resource type
                <select
                  name="resourceType"
                  defaultValue={resourceType}
                  className="mt-1 block h-9 rounded-[var(--radius-button)] border border-[var(--color-hairline)] bg-[var(--color-surface-elevated)] px-3 text-sm text-[var(--color-ink)]"
                >
                  <option value="">전체</option>
                  {resourceTypes.map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </label>
              <Button type="submit">필터 적용</Button>
            </form>
          </div>
          {filteredResources.length > 0 ? (
            <Table className="mt-4">
              <TableHeader>
                <TableRow>
                  <TableHead>자원</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Resource type</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>상세</TableHead>
                  <TableHead>연결</TableHead>
                  <TableHead>연결 추가</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredResources.map((resource) => {
                  const details = githubResourceDetails(resource.metadata);
                  const image = metadataString(resource.metadata, 'image');
                  return (
                    <TableRow key={resource.id}>
                      <TableCell>
                        <p className="font-medium text-[var(--color-ink)]">
                          {resource.name}
                        </p>
                        <p
                          className="mt-1 font-mono text-xs text-[var(--color-mute)]"
                          title={resource.externalId}
                        >
                          {resource.resourceType === 'docker_container'
                            ? shortContainerId(resource.externalId)
                            : resource.externalId}
                        </p>
                      </TableCell>
                      <TableCell>{resource.provider}</TableCell>
                      <TableCell>{resource.resourceType}</TableCell>
                      <TableCell>{resource.status ?? '—'}</TableCell>
                      <TableCell>
                        {details.lastCommit ? (
                          <div className="text-xs">
                            <p className="font-mono text-[var(--color-ink)]">
                              commit {details.lastCommit.sha.slice(0, 7)}
                            </p>
                            <p className="mt-1 text-[var(--color-mute)]">
                              {displayDate(details.lastCommit.committedAt)}
                              {details.lastWorkflowRun?.conclusion
                                ? ` · ${details.lastWorkflowRun.conclusion}`
                                : ''}
                            </p>
                          </div>
                        ) : (image ?? resource.region ?? '—')}
                      </TableCell>
                      <TableCell>
                        {resource.links.length > 0 ? (
                          <div className="space-y-2">
                            {resource.links.map((link) => (
                              <div
                                key={link.linkId}
                                className="flex flex-wrap items-center gap-2"
                              >
                                <Link
                                  href={`/projects/${link.projectSlug}`}
                                  className="text-sm text-[var(--color-info)] hover:underline"
                                >
                                  {link.projectName} / {link.componentName}
                                </Link>
                                <form action={removeResourceLink}>
                                  <input
                                    type="hidden"
                                    name="linkId"
                                    value={link.linkId}
                                  />
                                  <Button
                                    type="submit"
                                    variant="tertiary"
                                    className="h-7 px-2 text-xs"
                                  >
                                    연결 해제
                                  </Button>
                                </form>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <Badge>Unlinked</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <SuggestionForm
                          resourceId={resource.id}
                          components={componentOptions}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="mt-4 text-sm text-[var(--color-mute)]">
              조건에 맞는 자원이 없습니다.
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
                  {resource.name}
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
