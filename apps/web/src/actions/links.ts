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

function requiredString(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${name} 값이 필요합니다.`);
  }
  return value;
}

export async function confirmResourceLink(formData: FormData): Promise<void> {
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
      resourceName: schema.resources.name,
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

  const normalizedExternalId = resource.externalId.toLowerCase();
  const normalizedResourceName = resource.resourceName.toLowerCase();
  const normalizedSlug = selection.projectSlug.toLowerCase();

  let linkedBy: 'repository' | 'user';
  if (selection.repository !== null) {
    if (selection.repository.toLowerCase() !== normalizedExternalId) {
      throw new Error('저장소가 프로젝트 repository와 정확히 일치하지 않습니다.');
    }
    linkedBy = 'repository';
  } else {
    if (normalizedSlug !== normalizedResourceName) {
      throw new Error('저장소 이름이 프로젝트 slug와 정확히 일치하지 않습니다.');
    }
    linkedBy = 'user';
  }

  await db
    .insert(schema.componentResources)
    .values({
      componentId: selection.componentId,
      resourceId: resource.resourceId,
      environment: 'production',
      relationType: 'uses',
      isPrimary: false,
      linkedBy,
    })
    .onConflictDoUpdate({
      target: [
        schema.componentResources.componentId,
        schema.componentResources.resourceId,
        schema.componentResources.environment,
      ],
      set: {
        relationType: 'uses',
        linkedBy,
      },
    });

  revalidatePath('/resources');
  revalidatePath(`/projects/${selection.projectSlug}`);
  revalidatePath('/');
}
