import Link from 'next/link';
import { notFound } from 'next/navigation';
import { desc, eq, sql } from 'drizzle-orm';
import {
  computeDrift,
  getProjectBySlug,
  listProjectStatusData,
  listProjectResources,
  listTimelineEvents,
  schema,
  type DriftKind,
  type ProjectStatus,
} from '@deployhub/db';
import { Topbar } from '../../../components/shell/topbar';
import { TimelineList } from '../../../components/events/timeline-list';
import { Annotation } from '../../../components/schematic/annotation';
import { Badge, type Tone } from '../../../components/ui/badge';
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
} from '../../../lib/backend-view';
import { formatDateTime } from '../../../lib/datetime';
import { summarizeProject } from '../../../lib/project-summary';
import {
  ArchitectureComposition,
  buildComposition,
  isComponentObservationResource,
} from './composition';

export const dynamic = 'force-dynamic';

const DRIFT_LABELS: Record<DriftKind, string> = {
  declared_not_observed: '선언했지만 관측되지 않음',
  observed_not_declared: '관측됐지만 선언되지 않음',
  image_mismatch: '이미지 불일치',
  provider_mismatch: 'Provider 불일치',
  link_conflict: '연결 충돌 · 사람 확인 필요',
};

const STATUS_TONES: Record<ProjectStatus, Tone> = {
  정상: 'neutral',
  미확인: 'neutral',
  주의: 'caution',
  장애: 'fault',
};

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const project = await getProjectBySlug(db, slug);
  if (!project) notFound();

  const renderedAt = new Date();
  const [
    linkedResources,
    drift,
    deployments,
    statusByProject,
  ] = await Promise.all([
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
    listProjectStatusData(db, [project.id]),
  ]);
  const status = statusByProject.get(project.id) ?? {
    status: '미확인' as const,
    hasObservation: false,
    latestEvents: [],
  };
  const evidenceEvents = status.latestEvents.filter((event) => (
    event.severity === 'warning' || event.severity === 'critical'
  ));
  const evidenceEventIds = new Set(evidenceEvents.map(
    (event) => event.id,
  ));
  const { events: historyEvents } = await listTimelineEvents(db, {
    projectId: project.id,
    excludeIds: [...evidenceEventIds],
    limit: 20,
  });
  const deployment = summarizeProject({
    components: project.components.map((component) => ({
      type: component.componentType,
      framework: component.framework,
      runtime: component.runtime,
      provider: component.provider,
    })),
    observedProviders: linkedResources
      .filter(isComponentObservationResource)
      .map((resource) => resource.provider),
  }).deployment;
  const composition = buildComposition({
    components: project.components.map((component) => ({
      id: component.id,
      name: component.name,
      componentType: component.componentType,
      framework: component.framework,
      runtime: component.runtime,
      language: component.language,
      provider: component.provider,
      containerName: component.containerName,
    })),
    resources: linkedResources.map((resource) => ({
      id: resource.linkId,
      componentId: resource.componentId,
      provider: resource.provider,
      resourceType: resource.resourceType,
      name: resource.name,
      status: resource.status,
    })),
  });
  const latestDeployments = [
    ...deployments.reduce((latest, item) => {
      const key = item.componentId ?? `project:${item.provider}`;
      if (!latest.has(key)) latest.set(key, item);
      return latest;
    }, new Map<string, (typeof deployments)[number]>()).values(),
  ];

  return (
    <>
      <Topbar title={project.name} />
      <main className="space-y-6 p-4 md:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link
              href="/"
              className="text-sm text-[var(--annotation)] hover:text-[var(--line)]"
            >
              ← 프로젝트 목록
            </Link>
            <h2 className="mt-4 text-xl font-medium text-[var(--line)]">
              {project.name}
            </h2>
            <p className="mt-1 text-sm text-[var(--annotation)]">
              {project.description ?? '설명이 없습니다.'}
            </p>
          </div>
          <Link
            href={`/projects/${project.slug}/edit`}
            className="inline-flex h-9 items-center rounded-[var(--radius-button)] border border-[var(--rule)] bg-[var(--paper)] px-3 text-sm font-medium text-[var(--line)] transition-colors hover:bg-white/[0.02]"
          >
            편집
          </Link>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--line-mute)]">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{project.lifecycle}</span>
            <MetadataDot />
            <span>중요도 {project.importance}</span>
            <MetadataDot />
            <span>{project.owner ?? '담당자 없음'}</span>
          </p>
          <Badge tone={STATUS_TONES[status.status]}>
            {status.status}
          </Badge>
        </div>

        <Card>
          <div>
            <h3 className="text-base font-medium text-[var(--line)]">
              구성도
            </h3>
            <p className="mt-1 text-xs text-[var(--annotation)]">
              왼쪽은 manifest 선언, 오른쪽은 연결된 관측 결과입니다.
            </p>
          </div>
          <ArchitectureComposition
            composition={composition}
            repository={project.repository}
            deployment={deployment}
            declaredProviders={project.components.flatMap((component) => (
              component.provider ? [component.provider] : []
            ))}
            domains={project.domains}
          />
        </Card>

        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-base font-medium text-[var(--line)]">
              판정 근거
            </h3>
            <span className="text-xs text-[var(--annotation)]">
              최신 주의·장애 이벤트 {evidenceEvents.length}건
            </span>
          </div>
          {evidenceEvents.length > 0 ? (
            <ul className="mt-4 space-y-3">
              {evidenceEvents.map((event) => {
                const component = project.components.find(
                  (candidate) => candidate.id === event.componentId,
                );
                const resource = linkedResources.find(
                  (candidate) => candidate.id === event.resourceId,
                );
                return (
                  <li
                    key={event.id}
                    className="rounded-[var(--radius-card)] border border-[var(--rule)] bg-[var(--paper)] p-4"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={event.severity === 'critical' ? 'fault' : 'caution'}>
                        {event.severity === 'critical' ? '장애' : '주의'}
                      </Badge>
                      <span className="text-sm font-medium text-[var(--line)]">
                        {resource?.name ?? component?.name ?? project.name}
                      </span>
                      <span className="font-mono text-xs text-[var(--annotation)]">
                        {event.kind}
                      </span>
                      <time
                        className="font-mono text-xs text-[var(--annotation)]"
                        dateTime={event.occurredAt.toISOString()}
                        title={formatDateTime(event.occurredAt)}
                      >
                        {formatRelativeTime(event.occurredAt, renderedAt)}
                      </time>
                    </div>
                    <p className="mt-2 text-sm text-[var(--line-mute)]">
                      <span className="font-mono">{event.currentValue}</span>
                      <span aria-hidden="true"> · </span>
                      {event.detail}
                    </p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-[var(--annotation)]">
              최신 주의 또는 장애 이벤트가 없습니다.
            </p>
          )}
        </Card>

        <Card>
          <div className="flex items-center gap-3">
            <h3 className="text-base font-medium text-[var(--line)]">
              최종 배포
            </h3>
            <span className="text-xs text-[var(--annotation)]">
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
                {latestDeployments.map((item) => {
                  const component = project.components.find(
                    (candidate) => candidate.id === item.componentId,
                  );
                  const occurredAt = item.startedAt ?? item.createdAt;
                  const iso = occurredAt.toISOString();
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium text-[var(--line)]">
                        {component?.name ?? '프로젝트'}
                        {item.provider === 'docker' ? (
                          <span
                            className="ml-2 font-mono text-xs text-[var(--annotation)]"
                            title={item.externalDeploymentId}
                          >
                            {shortContainerId(item.externalDeploymentId)}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="font-mono">{item.provider}</TableCell>
                      <TableCell className="font-mono">
                        {item.imageName ?? item.version ?? '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {item.commitSha?.slice(0, 7) ?? '—'}
                      </TableCell>
                      <TableCell className="font-mono">{item.status}</TableCell>
                      <TableCell>
                        <time
                          className="font-mono"
                          dateTime={iso}
                          title={formatDateTime(occurredAt)}
                        >
                          {formatRelativeTime(occurredAt, renderedAt)}
                        </time>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="mt-4 text-sm text-[var(--annotation)]">
              관측된 배포가 없습니다.
            </p>
          )}
        </Card>

        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-base font-medium text-[var(--line)]">
              변경 이력
            </h3>
            <span className="text-xs text-[var(--annotation)]">
              최근 {historyEvents.length}건
            </span>
          </div>
          <div className="mt-4 overflow-hidden rounded-[var(--radius-card)] border border-[var(--rule)]">
            <TimelineList
              events={historyEvents}
              renderedAt={renderedAt}
              emptyMessage="현재 판정 근거 외에 기록된 변경이 없습니다"
            />
          </div>
        </Card>

        {drift.length > 0 ? (
          <Card>
            <div className="flex items-center gap-3">
              <h3 className="text-base font-medium text-[var(--line)]">
                Drift
              </h3>
              <span className="text-xs text-[var(--annotation)]">
                {drift.length}건
              </span>
            </div>
            <ul className="mt-4 space-y-2">
              {drift.map((item, index) => {
                const conflict = item.kind === 'link_conflict';
                return (
                  <li
                    key={`${item.kind}:${item.componentId ?? 'project'}:${index}`}
                    className={
                      conflict
                        ? 'rounded-[var(--radius-card)] border-2 border-[var(--fault)] bg-[var(--paper)] p-3'
                        : 'rounded-[var(--radius-card)] border border-[var(--rule)] p-3'
                    }
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={conflict ? 'fault' : 'neutral'}>
                        {DRIFT_LABELS[item.kind]}
                      </Badge>
                      {item.declared ? (
                        <span className="font-mono text-xs text-[var(--annotation)]">
                          선언: {item.declared}
                        </span>
                      ) : null}
                      <Annotation
                        value={item.observed}
                        drift={item.observed !== null}
                      />
                    </div>
                    <p className="mt-2 text-sm text-[var(--line-mute)]">
                      {item.detail}
                    </p>
                  </li>
                );
              })}
            </ul>
          </Card>
        ) : null}
      </main>
    </>
  );
}

function MetadataDot() {
  return <span aria-hidden="true" className="text-[var(--absent)]">·</span>;
}
