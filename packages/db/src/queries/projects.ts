import { asc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../client';
import { components, projects } from '../schema/projects';

export type ProjectRow = typeof projects.$inferSelect;
export type ComponentRow = typeof components.$inferSelect;
export type ProjectDetail = ProjectRow & { components: ComponentRow[] };

export async function listProjects(db: Db): Promise<ProjectRow[]> {
  return db.select().from(projects).where(isNull(projects.archivedAt)).orderBy(asc(projects.name));
}

export async function getProjectBySlug(db: Db, slug: string): Promise<ProjectDetail | undefined> {
  const [project] = await db.select().from(projects).where(eq(projects.slug, slug));
  if (!project) return undefined;
  const rows = await db
    .select()
    .from(components)
    .where(eq(components.projectId, project.id))
    .orderBy(asc(components.name));
  return { ...project, components: rows };
}
