import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  sql,
} from 'drizzle-orm';
import type { Db } from '../client';
import { deployments } from '../schema/observations';
import {
  components,
  domains,
  projectSnapshots,
  projects,
} from '../schema/projects';
import { componentResources, resources } from '../schema/resources';
import {
  listProjectStatusData,
  type ProjectStatus,
} from './status';

export type ProjectRow = typeof projects.$inferSelect;
export type ComponentRow = typeof components.$inferSelect;
export type DomainRow = typeof domains.$inferSelect;
export type ProjectDetail = ProjectRow & {
  components: ComponentRow[];
  domains: DomainRow[];
};
export type ProjectSnapshotSummary = {
  hasImage: boolean;
  source: typeof projectSnapshots.$inferSelect['source'];
  capturedAt: Date | null;
  checksum: string | null;
  lastAttemptStatus: typeof projectSnapshots.$inferSelect['lastAttemptStatus'];
};
export type ProjectListSummaryData = ProjectRow & {
  components: ComponentRow[];
  observedProviders: string[];
  latestDeploymentAt: Date | null;
  judgement: ProjectStatus;
  /** 구성요소 id → 관측된 컨테이너 이름과 상태. 없으면 키가 없다. */
  componentObservations: Map<string, { name: string; state: string }>;
  snapshot: ProjectSnapshotSummary;
};

export async function listProjects(db: Db): Promise<ProjectRow[]> {
  return db.select().from(projects).where(isNull(projects.archivedAt)).orderBy(asc(projects.name));
}

export async function listProjectsWithSummaryData(
  db: Db,
): Promise<ProjectListSummaryData[]> {
  const projectRows = await listProjects(db);
  if (projectRows.length === 0) return [];

  const projectIds = projectRows.map((project) => project.id);
  const deploymentTime = sql<Date>`coalesce(
    ${deployments.startedAt},
    ${deployments.createdAt}
  )`.mapWith(deployments.createdAt);

  // These are the only five follow-up queries for the whole project list.
  // The total stays at six regardless of how many projects are returned.
  const [
    componentRows,
    linkedResourceRows,
    latestDeploymentRows,
    statusByProject,
    snapshotRows,
  ] = await Promise.all([
    db
      .select()
      .from(components)
      .where(inArray(components.projectId, projectIds))
      .orderBy(asc(components.name)),
    db
      .select({
        projectId: components.projectId,
        provider: resources.provider,
        componentId: componentResources.componentId,
        resourceName: resources.name,
        resourceStatus: resources.status,
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
      .orderBy(
        asc(components.projectId),
        asc(componentResources.componentId),
        asc(resources.name),
        asc(resources.status),
        asc(resources.id),
      ),
    db
      .selectDistinctOn([deployments.projectId], {
        projectId: deployments.projectId,
        latestDeploymentAt: deploymentTime,
      })
      .from(deployments)
      .where(inArray(deployments.projectId, projectIds))
      .orderBy(
        deployments.projectId,
        desc(deploymentTime),
        desc(deployments.createdAt),
      ),
    listProjectStatusData(db, projectIds),
    db
      .select({
        projectId: projectSnapshots.projectId,
        hasImage: sql<boolean>`${projectSnapshots.imageData} is not null`,
        source: projectSnapshots.source,
        capturedAt: projectSnapshots.capturedAt,
        checksum: projectSnapshots.checksum,
        lastAttemptStatus: projectSnapshots.lastAttemptStatus,
      })
      .from(projectSnapshots)
      .where(inArray(projectSnapshots.projectId, projectIds)),
  ]);

  const componentsByProject = new Map<string, ComponentRow[]>();
  for (const component of componentRows) {
    const rows = componentsByProject.get(component.projectId) ?? [];
    rows.push(component);
    componentsByProject.set(component.projectId, rows);
  }

  const providersByProject = new Map<string, Set<string>>();
  const observationsByProject = new Map<
    string,
    Map<string, { name: string; state: string }>
  >();
  for (const resource of linkedResourceRows) {
    const providers = providersByProject.get(resource.projectId) ?? new Set<string>();
    providers.add(resource.provider);
    providersByProject.set(resource.projectId, providers);

    const observations = observationsByProject.get(resource.projectId) ?? new Map();
    if (!observations.has(resource.componentId)) {
      observations.set(resource.componentId, {
        name: resource.resourceName,
        state: resource.resourceStatus ?? '',
      });
    }
    observationsByProject.set(resource.projectId, observations);
  }

  const latestDeploymentByProject = new Map(
    latestDeploymentRows.flatMap((deployment) => (
      deployment.projectId
        ? [[deployment.projectId, deployment.latestDeploymentAt] as const]
        : []
    )),
  );

  const snapshotsByProject = new Map(snapshotRows.map((snapshot) => [
    snapshot.projectId,
    {
      hasImage: snapshot.hasImage,
      source: snapshot.source,
      capturedAt: snapshot.capturedAt,
      checksum: snapshot.checksum,
      lastAttemptStatus: snapshot.lastAttemptStatus,
    },
  ]));

  return projectRows.map((project) => ({
    ...project,
    components: componentsByProject.get(project.id) ?? [],
    observedProviders: [...(providersByProject.get(project.id) ?? [])].sort(),
    latestDeploymentAt: latestDeploymentByProject.get(project.id) ?? null,
    judgement: statusByProject.get(project.id)?.status ?? '미확인',
    componentObservations: observationsByProject.get(project.id) ?? new Map(),
    snapshot: snapshotsByProject.get(project.id) ?? {
      hasImage: false,
      source: null,
      capturedAt: null,
      checksum: null,
      lastAttemptStatus: null,
    },
  }));
}

export async function getProjectBySlug(db: Db, slug: string): Promise<ProjectDetail | undefined> {
  const [project] = await db.select().from(projects).where(eq(projects.slug, slug));
  if (!project) return undefined;
  const rows = await db
    .select()
    .from(components)
    .where(eq(components.projectId, project.id))
    .orderBy(asc(components.name));
  const domainRows = await db
    .select()
    .from(domains)
    .where(eq(domains.projectId, project.id))
    .orderBy(asc(domains.domain));
  return { ...project, components: rows, domains: domainRows };
}
