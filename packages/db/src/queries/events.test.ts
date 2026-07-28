import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isNull } from 'drizzle-orm';
import { startTestDb } from '../../test/helpers/pg';
import { schema, type Db } from '../index';
import { recordChangeIfChanged } from './events';

let db: Db;
let stop: () => Promise<void>;

beforeAll(async () => {
  const started = await startTestDb();
  db = started.db;
  stop = started.stop;
}, 120_000);

afterAll(async () => { await stop(); });

beforeEach(async () => {
  await db.delete(schema.changeEvents);
  await db.delete(schema.components);
  await db.delete(schema.resources);
  await db.delete(schema.projects);
});

async function seedProject(slug: string) {
  const [project] = await db.insert(schema.projects).values({ name: slug, slug }).returning();
  if (!project) throw new Error('project insert failed');
  return project;
}

async function seedComponent(projectId: string, slug: string) {
  const [component] = await db.insert(schema.components).values({
    projectId, name: slug, slug, componentType: 'backend',
  }).returning();
  if (!component) throw new Error('component insert failed');
  return component;
}

async function seedResource(name: string) {
  const [resource] = await db.insert(schema.resources).values({
    provider: 'docker', externalId: name, resourceType: 'docker_container', name,
  }).returning();
  if (!resource) throw new Error('resource insert failed');
  return resource;
}

const change = {
  kind: 'container_status' as const,
  severity: 'info' as const,
  detail: 'container state changed',
};

describe('recordChangeIfChanged', () => {
  it('records a first value with null previousValue', async () => {
    const written = await recordChangeIfChanged(db, { ...change, projectId: null, componentId: null, resourceId: null, currentValue: 'running' });

    expect(written).toBe(true);
    expect(await db.select().from(schema.changeEvents)).toMatchObject([
      { previousValue: null, currentValue: 'running' },
    ]);
  });

  it('does not record an unchanged value', async () => {
    const input = { ...change, projectId: null, componentId: null, resourceId: null, currentValue: 'running' };
    await recordChangeIfChanged(db, input);

    await expect(recordChangeIfChanged(db, input)).resolves.toBe(false);
    expect(await db.select().from(schema.changeEvents)).toHaveLength(1);
  });

  it('derives previousValue from the immediately preceding value', async () => {
    const target = { projectId: null, componentId: null, resourceId: null };
    await recordChangeIfChanged(db, { ...change, ...target, currentValue: 'running' });

    await expect(recordChangeIfChanged(db, { ...change, ...target, currentValue: 'exited' })).resolves.toBe(true);
    const rows = await db.select().from(schema.changeEvents);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.currentValue === 'exited')?.previousValue).toBe('running');
  });

  it('records each transition when a value returns to an earlier value', async () => {
    const target = { projectId: null, componentId: null, resourceId: null };
    await recordChangeIfChanged(db, { ...change, ...target, currentValue: 'running' });
    await recordChangeIfChanged(db, { ...change, ...target, currentValue: 'exited' });
    await recordChangeIfChanged(db, { ...change, ...target, currentValue: 'running' });

    expect(await db.select().from(schema.changeEvents)).toHaveLength(3);
  });

  it('uses resource identity before component and project identity', async () => {
    const project = await seedProject('resource-precedence');
    const component = await seedComponent(project.id, 'api');
    const otherProject = await seedProject('resource-precedence-other');
    const otherComponent = await seedComponent(otherProject.id, 'worker');
    const resource = await seedResource('resource-precedence');
    await recordChangeIfChanged(db, { ...change, projectId: project.id, componentId: component.id, resourceId: resource.id, currentValue: 'running' });

    await expect(recordChangeIfChanged(db, { ...change, projectId: otherProject.id, componentId: otherComponent.id, resourceId: resource.id, currentValue: 'running' })).resolves.toBe(false);
    await expect(recordChangeIfChanged(db, { ...change, projectId: otherProject.id, componentId: otherComponent.id, resourceId: null, currentValue: 'running' })).resolves.toBe(true);
    expect(await db.select().from(schema.changeEvents)).toHaveLength(2);
  });

  it('uses component identity before project identity', async () => {
    const project = await seedProject('component-precedence');
    const component = await seedComponent(project.id, 'api');
    const otherProject = await seedProject('component-precedence-other');
    await recordChangeIfChanged(db, { ...change, projectId: project.id, componentId: component.id, resourceId: null, currentValue: 'running' });

    await expect(recordChangeIfChanged(db, { ...change, projectId: otherProject.id, componentId: component.id, resourceId: null, currentValue: 'running' })).resolves.toBe(false);
    await expect(recordChangeIfChanged(db, { ...change, projectId: otherProject.id, componentId: null, resourceId: null, currentValue: 'running' })).resolves.toBe(true);
    expect(await db.select().from(schema.changeEvents)).toHaveLength(2);
  });

  it('deduplicates global all-null events independently', async () => {
    const input = { ...change, projectId: null, componentId: null, resourceId: null, currentValue: 'running' };
    await expect(recordChangeIfChanged(db, input)).resolves.toBe(true);
    await expect(recordChangeIfChanged(db, input)).resolves.toBe(false);
    expect(await db.select().from(schema.changeEvents).where(isNull(schema.changeEvents.projectId))).toHaveLength(1);
  });
});
