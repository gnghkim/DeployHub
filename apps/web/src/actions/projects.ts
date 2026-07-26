'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { schema } from '@deployhub/db';
import { auth } from '../auth/config';
import { db } from '../lib/db';
import { projectInputSchema, type ProjectInput } from '../lib/schemas';

export type ProjectActionState = {
  status: 'idle' | 'error' | 'success';
  message?: string;
  fieldErrors?: Partial<Record<keyof ProjectInput, string[]>>;
};

function inputFrom(formData: FormData) {
  return {
    name: formData.get('name'),
    slug: formData.get('slug'),
    description: formData.get('description'),
    status: formData.get('status'),
    lifecycle: formData.get('lifecycle'),
    importance: formData.get('importance'),
    owner: formData.get('owner'),
    repository: formData.get('repository'),
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; cause?: unknown };
  return candidate.code === '23505' || isUniqueViolation(candidate.cause);
}

export async function createProject(
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const session = await auth();
  if (!session) throw new Error('인증이 필요합니다.');

  const parsed = projectInputSchema.safeParse(inputFrom(formData));
  if (!parsed.success) {
    return {
      status: 'error',
      message: '입력값을 확인해 주세요.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await db.insert(schema.projects).values({
      ...parsed.data,
      description: parsed.data.description ?? null,
      owner: parsed.data.owner ?? null,
      repository: parsed.data.repository ?? null,
      archivedAt: parsed.data.status === 'archived' ? new Date() : null,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        status: 'error',
        message: '이미 사용 중인 slug입니다.',
        fieldErrors: { slug: ['이미 사용 중인 slug입니다.'] },
      };
    }
    return { status: 'error', message: '프로젝트를 저장하지 못했습니다.' };
  }

  revalidatePath('/projects');
  return { status: 'success', message: '프로젝트를 등록했습니다.' };
}

export async function updateProject(
  id: string,
  _previousState: ProjectActionState,
  formData: FormData,
): Promise<ProjectActionState> {
  const session = await auth();
  if (!session) throw new Error('인증이 필요합니다.');

  const parsed = projectInputSchema.safeParse(inputFrom(formData));
  if (!parsed.success) {
    return {
      status: 'error',
      message: '입력값을 확인해 주세요.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    const [updated] = await db
      .update(schema.projects)
      .set({
        ...parsed.data,
        description: parsed.data.description ?? null,
        owner: parsed.data.owner ?? null,
        repository: parsed.data.repository ?? null,
        archivedAt: parsed.data.status === 'archived' ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(schema.projects.id, id))
      .returning({ slug: schema.projects.slug });

    if (!updated) return { status: 'error', message: '프로젝트를 찾을 수 없습니다.' };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        status: 'error',
        message: '이미 사용 중인 slug입니다.',
        fieldErrors: { slug: ['이미 사용 중인 slug입니다.'] },
      };
    }
    return { status: 'error', message: '프로젝트를 저장하지 못했습니다.' };
  }

  revalidatePath('/projects');
  revalidatePath(`/projects/${parsed.data.slug}`);
  return { status: 'success', message: '프로젝트를 수정했습니다.' };
}

export async function archiveProject(id: string): Promise<void> {
  const session = await auth();
  if (!session) throw new Error('인증이 필요합니다.');

  const [archived] = await db
    .update(schema.projects)
    .set({
      status: 'archived',
      archivedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.projects.id, id))
    .returning({ slug: schema.projects.slug });

  if (!archived) throw new Error('프로젝트를 찾을 수 없습니다.');

  revalidatePath('/projects');
  revalidatePath(`/projects/${archived.slug}`);
  redirect('/projects');
}
