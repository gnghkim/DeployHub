import Link from 'next/link';
import { notFound } from 'next/navigation';
import { desc, eq, sql } from 'drizzle-orm';
import {
  computeDrift,
  getProjectBySlug,
  listProjectResources,
  schema,
  type DriftKind,
} from '@deployhub/db';
import { deleteComponent } from '../../../actions/components';
import { archiveProject } from '../../../actions/projects';
import { Topbar } from '../../../components/shell/topbar';
import { Badge, type Tone } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../../components/ui/table';
import { db } from '../../../lib/db';
import {
  formatRelativeTime,
  shortContainerId,
  summarizeBackend,
} from '../../../lib/backend-view';
import { ProjectForm } from '../project-form';
import { ComponentForm } from './components/component-form';

export const dynamic = 'force-dynamic';

const STATUS_TONES: Record<string, Tone> = {
  active: 'success',
  paused: 'warning',
  maintenance: 'warning',
  archived: 'neutral',
};

const DRIFT_LABELS: Record<DriftKind, string> = {
  declared_not_observed: '선언했지만 관측되지 않음',
  observed_not_declared: '관측됐지만 선언되지 않음',
  image_mismatch: '이미지 불일치',
  provider_mismatch: 'Provider 불일치',
  link_conflict: '연결 충돌 · 사람 확인 필요',
};

const DATE_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

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

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = await getProjectBySlug(db, slug);
  if (!project) notFound();
  const renderedAt = new Date();
  const [linkedResources, drift, deployments] = await Promise.all([
    listProjectResources(db, project.id),
    computeDrift(db, project.id),
    db
      .select()
      .from(schema.deployments)
      .where(eq(schema.deployments.projectId, project.id))
      .orderBy(
        desc(sql`coalesce(
          ${schema.deployments.startedAt},
          ${schema.deployments.createdAt}
        )`),
        desc(schema.deployments.createdAt),
      ),
  ]);
  const backendSummary = summarizeBackend({
    observedProviders: linkedResources.map((resource) => resource.provider),
    declaredProviders: project.components.map(
      (component) => component.provider,
    ),
  });
  const latestDeployments = [
    ...deployments.reduce((latest, deployment) => {
      const key = deployment.componentId ?? `project:${deployment.provider}`;
      if (!latest.has(key)) latest.set(key, deployment);
      return latest;
    }, new Map<string, (typeof deployments)[number]>()).values(),
  ];

  const archiveAction = archiveProject.bind(null, project.id);

  return (
    <>
      <Topbar title={project.name} />
      <main className="space-y-6 p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link href="/projects" className="text-sm text-[var(--color-mute)] hover:text-[var(--color-ink)]">
              ← 프로젝트 목록
            </Link>
            <div className="mt-4 flex items-center gap-3">
              <h2 className="text-xl font-medium text-[var(--color-ink)]">{project.name}</h2>
              <Badge tone={STATUS_TONES[project.status] ?? 'neutral'}>{project.status}</Badge>
            </div>
            <p className="mt-1 text-sm text-[var(--color-mute)]">
              {project.description ?? '설명이 없습니다.'}
            </p>
          </div>
          <form action={archiveAction}>
            <Button type="submit" variant="tertiary">보관</Button>
          </form>
        </div>

        <Card>
          <h3 className="mb-5 text-base font-medium text-[var(--color-ink)]">Overview</h3>
          <ProjectForm project={project} />
        </Card>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-medium text-[var(--color-ink)]">
              뒷단
            </h3>
            <p className="text-sm font-medium text-[var(--color-ink)]">
              {backendSummary}
            </p>
          </div>
          <p className="mt-2 text-xs text-[var(--color-mute)]">
            요약은 연결된 관측 자원만으로 계산합니다. 괄호 안은 manifest 선언입니다.
          </p>
          {project.components.length > 0 ? (
            <Table className="mt-4">
              <TableHeader>
                <TableRow>
                  <TableHead>구성요소</TableHead>
                  <TableHead>선언</TableHead>
                  <TableHead>관측</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {project.components.map((component) => {
                  const observed = linkedResources.filter(
                    (resource) => resource.componentId === component.id,
                  );
                  const declaration = [
                    component.provider,
                    component.containerName,
                    component.externalRef,
                  ].filter(Boolean).join(' · ');
                  return (
                    <TableRow key={component.id}>
                      <TableCell className="font-medium text-[var(--color-ink)]">
                        {component.name}
                      </TableCell>
                      <TableCell>
                        {declaration || '없음'}
                      </TableCell>
                      <TableCell>
                        {observed.length > 0 ? (
                          <div className="space-y-1">
                            {observed.map((resource) => {
                              const image = metadataString(
                                resource.metadata,
                                'image',
                              );
                              return (
                                <p key={resource.linkId}>
                                  {resource.provider}
                                  {' · '}
                                  {resource.resourceType === 'docker_container'
                                    ? shortContainerId(resource.externalId)
                                    : resource.name}
                                  {' · '}
                                  {resource.status ?? '상태 미확인'}
                                  {image ? ` · ${image}` : ''}
                                </p>
                              );
                            })}
                          </div>
                        ) : '미확인'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="mt-4 text-sm text-[var(--color-mute)]">
              등록된 구성요소가 없습니다.
            </p>
          )}

          <div className="mt-6 border-t border-[var(--color-hairline)] pt-5">
            <div className="flex flex-wrap items-center gap-3">
              <h4 className="font-medium text-[var(--color-ink)]">Drift</h4>
              {drift.length === 0 ? (
                <Badge tone="success">없음</Badge>
              ) : (
                <Badge tone="warning">{drift.length}건</Badge>
              )}
            </div>
            {drift.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {drift.map((item, index) => {
                  const conflict = item.kind === 'link_conflict';
                  return (
                    <li
                      key={`${item.kind}:${item.componentId ?? 'project'}:${index}`}
                      className={
                        conflict
                          ? 'rounded-[var(--radius-card)] border-2 border-[var(--color-error)] bg-[var(--color-surface-elevated)] p-3'
                          : 'rounded-[var(--radius-card)] border border-[var(--color-hairline)] p-3'
                      }
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={conflict ? 'error' : 'warning'}>
                          {DRIFT_LABELS[item.kind]}
                        </Badge>
                        {item.declared ? (
                          <span className="text-xs text-[var(--color-mute)]">
                            선언: {item.declared}
                          </span>
                        ) : null}
                        {item.observed ? (
                          <span className="text-xs text-[var(--color-mute)]">
                            관측: {item.observed}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm text-[var(--color-body)]">
                        {item.detail}
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="text-base font-medium text-[var(--color-ink)]">구성요소</h3>
              <span className="text-xs text-[var(--color-mute)]">{project.components.length}개</span>
            </div>
            <Link
              href={`/projects/${project.slug}/components/new`}
              className="inline-flex h-9 items-center rounded-[var(--radius-button)] border border-[var(--color-hairline)] bg-[var(--color-surface-elevated)] px-3 text-sm font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-card)]"
            >
              구성요소 추가
            </Link>
          </div>
          {project.components.length ? (
            <>
              <Table className="mt-4">
                <TableHeader>
                  <TableRow>
                    <TableHead>이름</TableHead>
                    <TableHead>타입</TableHead>
                    <TableHead>Framework</TableHead>
                    <TableHead>Runtime</TableHead>
                    <TableHead>Language</TableHead>
                    <TableHead>중요도</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {project.components.map((component) => (
                    <TableRow key={component.id}>
                      <TableCell className="font-medium text-[var(--color-ink)]">
                        {component.name}
                      </TableCell>
                      <TableCell>{component.componentType}</TableCell>
                      <TableCell>{component.framework ?? '—'}</TableCell>
                      <TableCell>{component.runtime ?? '—'}</TableCell>
                      <TableCell>{component.language ?? '—'}</TableCell>
                      <TableCell>{component.criticality}/5</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="mt-6 space-y-3">
                {project.components.map((component) => {
                  const deleteAction = deleteComponent.bind(null, component.id);
                  return (
                    <details
                      key={component.id}
                      className="rounded-[var(--radius-card)] border border-[var(--color-hairline)] px-4 py-3"
                    >
                      <summary className="cursor-pointer text-sm font-medium text-[var(--color-ink)]">
                        {component.name} 수정
                      </summary>
                      <div className="mt-5">
                        <ComponentForm projectId={project.id} component={component} />
                        <form action={deleteAction} className="mt-3">
                          <Button type="submit" variant="tertiary">구성요소 삭제</Button>
                        </form>
                      </div>
                    </details>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="mt-4 text-sm text-[var(--color-mute)]">
              아직 등록된 구성요소가 없습니다.
            </p>
          )}
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <h3 className="text-base font-medium text-[var(--color-ink)]">
              연결된 자원
            </h3>
            <span className="text-xs text-[var(--color-mute)]">
              {linkedResources.length}개
            </span>
          </div>
          {linkedResources.length > 0 ? (
            <Table className="mt-4">
              <TableHeader>
                <TableRow>
                  <TableHead>자원</TableHead>
                  <TableHead>타입</TableHead>
                  <TableHead>구성요소</TableHead>
                  <TableHead>환경</TableHead>
                  <TableHead>연결 근거</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linkedResources.map((resource) => (
                  <TableRow key={resource.linkId}>
                    <TableCell className="font-medium text-[var(--color-ink)]">
                      <span title={resource.externalId}>
                        {resource.resourceType === 'docker_container'
                          ? shortContainerId(resource.externalId)
                          : resource.externalId}
                      </span>
                    </TableCell>
                    <TableCell>{resource.resourceType}</TableCell>
                    <TableCell>{resource.componentName}</TableCell>
                    <TableCell>{resource.environment}</TableCell>
                    <TableCell>
                      <Badge>{resource.linkedBy}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="mt-4 text-sm text-[var(--color-mute)]">
              아직 연결된 자원이 없습니다.
            </p>
          )}
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <h3 className="text-base font-medium text-[var(--color-ink)]">
              최종 배포
            </h3>
            <span className="text-xs text-[var(--color-mute)]">
              {latestDeployments.length}개 구성요소
            </span>
          </div>
          {latestDeployments.length > 0 ? (
            <Table className="mt-4">
              <TableHeader>
                <TableRow>
                  <TableHead>구성요소</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>버전 / 이미지</TableHead>
                  <TableHead>Commit</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead>배포 시각</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {latestDeployments.map((deployment) => {
                  const component = project.components.find(
                    (candidate) => candidate.id === deployment.componentId,
                  );
                  const occurredAt = deployment.startedAt
                    ?? deployment.createdAt;
                  const iso = occurredAt.toISOString();
                  return (
                    <TableRow key={deployment.id}>
                      <TableCell className="font-medium text-[var(--color-ink)]">
                        {component?.name ?? '프로젝트'}
                        {deployment.provider === 'docker' ? (
                          <span
                            className="ml-2 font-mono text-xs text-[var(--color-mute)]"
                            title={deployment.externalDeploymentId}
                          >
                            {shortContainerId(
                              deployment.externalDeploymentId,
                            )}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>{deployment.provider}</TableCell>
                      <TableCell>
                        {deployment.imageName ?? deployment.version ?? '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {deployment.commitSha?.slice(0, 7) ?? '—'}
                      </TableCell>
                      <TableCell>{deployment.status}</TableCell>
                      <TableCell>
                        <time dateTime={iso} title={DATE_FORMAT.format(occurredAt)}>
                          {formatRelativeTime(occurredAt, renderedAt)}
                        </time>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="mt-4 text-sm text-[var(--color-mute)]">
              관측된 배포가 없습니다.
            </p>
          )}
        </Card>
      </main>
    </>
  );
}
