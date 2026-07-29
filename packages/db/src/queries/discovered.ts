import {
  and,
  eq,
  isNull,
  sql,
} from 'drizzle-orm';
import type { Db } from '../client';
import {
  componentResources,
  resources,
} from '../schema/resources';

const UNGROUPED_STACK = '(그룹 없음)';

export type DiscoveredStack = {
  stack: string;
  containers: Array<{
    name: string;
    image: string | null;
    status: string | null;
  }>;
};

type ObservedContainer = {
  id: string;
  stack: string | null;
  name: string;
  image: string | null;
  status: string | null;
  linked: boolean;
};

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export async function countDiscoveredStacks(db: Db): Promise<number> {
  const result = await db.execute<{ discovered_count: number }>(sql`
    WITH containers AS (
      SELECT
        r.id,
        nullif(btrim(r.metadata->>'composeProject'), '') AS stack,
        EXISTS (
          SELECT 1
          FROM component_resources cr
          WHERE cr.resource_id = r.id
        ) AS linked
      FROM resources r
      WHERE r.resource_type = 'docker_container'
        AND r.deleted_at IS NULL
    ),
    linked_stacks AS (
      SELECT DISTINCT stack
      FROM containers
      WHERE linked
        AND stack IS NOT NULL
    )
    SELECT count(
      DISTINCT coalesce(containers.stack, ${UNGROUPED_STACK})
    )::int AS discovered_count
    FROM containers
    WHERE NOT containers.linked
      AND (
        containers.stack IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM linked_stacks
          WHERE linked_stacks.stack = containers.stack
        )
      )
  `);

  return result.rows[0]?.discovered_count ?? 0;
}

export async function listDiscoveredStacks(db: Db): Promise<DiscoveredStack[]> {
  const composeProject = sql<string | null>`${resources.metadata}->>'composeProject'`;
  const image = sql<string | null>`${resources.metadata}->>'image'`;
  const rows = await db
    .select({
      id: resources.id,
      stack: composeProject,
      name: resources.name,
      image,
      status: resources.status,
      linkId: componentResources.id,
    })
    .from(resources)
    .leftJoin(
      componentResources,
      eq(componentResources.resourceId, resources.id),
    )
    .where(and(
      eq(resources.resourceType, 'docker_container'),
      isNull(resources.deletedAt),
    ));

  const containersById = new Map<string, ObservedContainer>();
  for (const row of rows) {
    const existing = containersById.get(row.id);
    if (existing) {
      existing.linked ||= row.linkId !== null;
      continue;
    }

    containersById.set(row.id, {
      id: row.id,
      stack: row.stack?.trim() || null,
      name: row.name,
      image: row.image,
      status: row.status,
      linked: row.linkId !== null,
    });
  }

  const containers = [...containersById.values()].sort((left, right) => (
    compareText(left.name, right.name) || compareText(left.id, right.id)
  ));
  const linkedStacks = new Set(
    containers
      .filter((container) => container.linked && container.stack !== null)
      .map((container) => container.stack!),
  );
  const stacks = new Map<string, DiscoveredStack>();

  for (const container of containers) {
    if (
      container.linked
      || (container.stack !== null && linkedStacks.has(container.stack))
    ) {
      continue;
    }

    const stackName = container.stack ?? UNGROUPED_STACK;
    const stack = stacks.get(stackName) ?? {
      stack: stackName,
      containers: [],
    };
    stack.containers.push({
      name: container.name,
      image: container.image,
      status: container.status,
    });
    stacks.set(stackName, stack);
  }

  return [...stacks.values()]
    .map((stack) => ({
      ...stack,
      containers: stack.containers.sort((left, right) => (
        compareText(left.name, right.name)
      )),
    }))
    .sort((left, right) => {
      if (left.stack === right.stack) return 0;
      if (left.stack === UNGROUPED_STACK) return 1;
      if (right.stack === UNGROUPED_STACK) return -1;
      return compareText(left.stack, right.stack);
    });
}
