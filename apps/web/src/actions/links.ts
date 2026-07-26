'use server';

import {
  and,
  eq,
  isNull,
} from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { schema } from '@deployhub/db';
import { auth } from '../auth/config';
import { db } from '../lib/db';

export type ResourceLinkActionState = {
  status: 'idle' | 'error' | 'success';
  message?: string;
};

function requiredString(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${name} 값이 필요합니다.`);
  }
  return value;
}

export async function confirmResourceLink(
  _previousState: ResourceLinkActionState,
  formData: FormData,
): Promise<ResourceLinkActionState> {
  const session = await auth();
  if (!session) throw new Error('인증이 필요합니다.');

  const componentId = requiredString(formData, 'componentId');
  const resourceId = requiredString(formData, 'resourceId');

  const [selection] = await db
    .select({
      componentId: schema.components.id,
      projectId: schema.projects.id,
      projectSlug: schema.projects.slug,
      repository: schema.projects.repository,
    })
    .from(schema.components)
    .innerJoin(
      schema.projects,
      eq(schema.projects.id, schema.components.projectId),
    )
    .where(eq(schema.components.id, componentId));
  if (!selection) throw new Error('연결할 구성요소를 찾을 수 없습니다.');

  const [resource] = await db
    .select({
      resourceId: schema.resources.id,
      externalId: schema.resources.externalId,
    })
    .from(schema.resources)
    .where(
      and(
        eq(schema.resources.id, resourceId),
        eq(schema.resources.resourceType, 'github_repository'),
        isNull(schema.resources.deletedAt),
      ),
    );
  if (!resource) throw new Error('연결할 저장소를 찾을 수 없습니다.');

  const linkedBy = (
    selection.repository?.toLowerCase() === resource.externalId.toLowerCase()
  ) ? 'repository' : 'user';

  let inserted: { id: string }[];
  try {
    inserted = await db
      .insert(schema.componentResources)
      .values({
        componentId: selection.componentId,
        resourceId: resource.resourceId,
        environment: 'production',
        relationType: 'uses',
        isPrimary: false,
        linkedBy,
      })
      .onConflictDoNothing({
        target: [
          schema.componentResources.componentId,
          schema.componentResources.resourceId,
          schema.componentResources.environment,
        ],
      })
      .returning({ id: schema.componentResources.id });
  } catch {
    return {
      status: 'error',
      message: '자원 연결을 저장하지 못했습니다.',
    };
  }

  if (inserted.length === 0) {
    return {
      status: 'error',
      message: '이 자원은 이미 선택한 구성요소에 연결되어 있습니다.',
    };
  }

  revalidatePath('/resources');
  revalidatePath(`/projects/${selection.projectSlug}`);
  revalidatePath('/');
  return { status: 'success', message: '자원을 연결했습니다.' };
}

export async function removeResourceLink(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session) throw new Error('인증이 필요합니다.');

  const linkId = requiredString(formData, 'linkId');
  const [deleted] = await db
    .delete(schema.componentResources)
    .where(eq(schema.componentResources.id, linkId))
    .returning({ componentId: schema.componentResources.componentId });
  if (!deleted) throw new Error('연결을 찾을 수 없습니다.');

  const [project] = await db
    .select({ projectSlug: schema.projects.slug })
    .from(schema.components)
    .innerJoin(
      schema.projects,
      eq(schema.projects.id, schema.components.projectId),
    )
    .where(eq(schema.components.id, deleted.componentId));

  revalidatePath('/resources');
  if (project) revalidatePath(`/projects/${project.projectSlug}`);
  revalidatePath('/');
}
