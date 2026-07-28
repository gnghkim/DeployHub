import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  sql,
} from 'drizzle-orm';
import type { Db } from '../client';
import { deployments } from '../schema/observations';
import { components, domains, projects } from '../schema/projects';
import { componentResources, resources } from '../schema/resources';

export type ProjectRow = typeof projects.$inferSelect;
export type ComponentRow = typeof components.$inferSelect;
export type DomainRow = typeof domains.$inferSelect;
export type ProjectDetail = ProjectRow & {
  components: ComponentRow[];
  domains: DomainRow[];
};
export type ProjectListSummaryData = ProjectRow & {
  components: ComponentRow[];
  observedProviders: string[];
  latestDeploymentAt: Date | null;
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

  // These are the only three follow-up queries for the whole project list.
  // The total stays at four regardless of how many projects are returned.
  const [componentRows, linkedResourceRows, latestDeploymentRows] = await Promise.all([
    db
      .select()
      .from(components)
      .where(inArray(components.projectId, projectIds))
      .orderBy(asc(components.name)),
    db
      .select({
        projectId: components.projectId,
        provider: resources.provider,
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
      )),
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
  ]);

  const componentsByProject = new Map<string, ComponentRow[]>();
  for (const component of componentRows) {
    const rows = componentsByProject.get(component.projectId) ?? [];
    rows.push(component);
    componentsByProject.set(component.projectId, rows);
  }

  const providersByProject = new Map<string, Set<string>>();
  for (const resource of linkedResourceRows) {
    const providers = providersByProject.get(resource.projectId) ?? new Set<string>();
    providers.add(resource.provider);
    providersByProject.set(resource.projectId, providers);
  }

  const latestDeploymentByProject = new Map(
    latestDeploymentRows.flatMap((deployment) => (
      deployment.projectId
        ? [[deployment.projectId, deployment.latestDeploymentAt] as const]
        : []
    )),
  );

  return projectRows.map((project) => ({
    ...project,
    components: componentsByProject.get(project.id) ?? [],
    observedProviders: [...(providersByProject.get(project.id) ?? [])].sort(),
    latestDeploymentAt: latestDeploymentByProject.get(project.id) ?? null,
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
