import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import type { Db } from '../client';
import { changeEvents } from '../schema/events';
import { components, projects } from '../schema/projects';
import { componentResources, resources } from '../schema/resources';

export type ProjectStatus = '정상' | '주의' | '장애' | '미확인';

export type StatusEvent = {
  kind: string;
  severity: 'info' | 'warning' | 'critical';
};

export type LatestProjectEvent = {
  id: string;
  seq: bigint;
  projectId: string | null;
  componentId: string | null;
  resourceId: string | null;
  kind: typeof changeEvents.$inferSelect.kind;
  severity: typeof changeEvents.$inferSelect.severity;
  previousValue: string | null;
  currentValue: string;
  detail: string;
  occurredAt: Date;
};

export type ProjectStatusData = {
  status: ProjectStatus;
  hasObservation: boolean;
  latestEvents: LatestProjectEvent[];
};

export function judgeStatus({
  latestEvents,
  hasObservation,
}: {
  latestEvents: StatusEvent[];
  hasObservation: boolean;
}): ProjectStatus {
  if (latestEvents.some((event) => event.severity === 'critical')) {
    return '장애';
  }
  if (latestEvents.some((event) => event.severity === 'warning')) {
    return '주의';
  }
  if (latestEvents.length === 0 && !hasObservation) {
    return '미확인';
  }
  return '정상';
}

export async function listProjectStatusData(
  db: Db,
  projectIds: string[],
): Promise<Map<string, ProjectStatusData>> {
  if (projectIds.length === 0) return new Map();

  const latestEvents = db
    .selectDistinctOn(
      [
        changeEvents.projectId,
        changeEvents.componentId,
        changeEvents.resourceId,
        changeEvents.kind,
      ],
      {
        id: changeEvents.id,
        seq: changeEvents.seq,
        projectId: changeEvents.projectId,
        componentId: changeEvents.componentId,
        resourceId: changeEvents.resourceId,
        kind: changeEvents.kind,
        severity: changeEvents.severity,
        previousValue: changeEvents.previousValue,
        currentValue: changeEvents.currentValue,
        detail: changeEvents.detail,
        occurredAt: changeEvents.occurredAt,
      },
    )
    .from(changeEvents)
    .leftJoin(resources, eq(resources.id, changeEvents.resourceId))
    .where(and(
      inArray(changeEvents.projectId, projectIds),
      or(
        isNull(changeEvents.resourceId),
        isNull(resources.deletedAt),
      ),
    ))
    .orderBy(
      changeEvents.projectId,
      changeEvents.componentId,
      changeEvents.resourceId,
      changeEvents.kind,
      desc(changeEvents.seq),
    )
    .as('latest_project_events');

  const observedProjects = db
    .selectDistinct({
      projectId: components.projectId,
    })
    .from(componentResources)
    .innerJoin(
      components,
      eq(components.id, componentResources.componentId),
    )
    .innerJoin(resources, eq(resources.id, componentResources.resourceId))
    .where(and(
      inArray(components.projectId, projectIds),
      isNull(resources.deletedAt),
      ne(componentResources.linkedBy, 'suggested'),
    ))
    .as('observed_projects');

  const rows = await db
    .select({
      projectId: projects.id,
      hasObservation: sql<boolean>`${observedProjects.projectId} is not null`,
      eventId: latestEvents.id,
      seq: latestEvents.seq,
      eventProjectId: latestEvents.projectId,
      componentId: latestEvents.componentId,
      resourceId: latestEvents.resourceId,
      kind: latestEvents.kind,
      severity: latestEvents.severity,
      previousValue: latestEvents.previousValue,
      currentValue: latestEvents.currentValue,
      detail: latestEvents.detail,
      occurredAt: latestEvents.occurredAt,
    })
    .from(projects)
    .leftJoin(latestEvents, eq(latestEvents.projectId, projects.id))
    .leftJoin(
      observedProjects,
      eq(observedProjects.projectId, projects.id),
    )
    .where(inArray(projects.id, projectIds));

  const result = new Map<string, ProjectStatusData>();
  for (const projectId of projectIds) {
    result.set(projectId, {
      status: '미확인',
      hasObservation: false,
      latestEvents: [],
    });
  }

  for (const row of rows) {
    const project = result.get(row.projectId);
    if (!project) continue;
    project.hasObservation = row.hasObservation;
    if (
      row.eventId
      && row.seq !== null
      && row.kind
      && row.severity
      && row.currentValue !== null
      && row.detail !== null
      && row.occurredAt
    ) {
      project.latestEvents.push({
        id: row.eventId,
        seq: row.seq,
        projectId: row.eventProjectId,
        componentId: row.componentId,
        resourceId: row.resourceId,
        kind: row.kind,
        severity: row.severity,
        previousValue: row.previousValue,
        currentValue: row.currentValue,
        detail: row.detail,
        occurredAt: row.occurredAt,
      });
    }
  }

  for (const project of result.values()) {
    project.status = judgeStatus(project);
  }
  return result;
}
