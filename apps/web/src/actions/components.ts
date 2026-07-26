'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { schema } from '@deployhub/db';
import { auth } from '../auth/config';
import { db } from '../lib/db';
import { componentInputSchema, type ComponentInput } from '../lib/schemas';

export type ComponentActionState = {
  status: 'idle' | 'error' | 'success';
  message?: string;
  fieldErrors?: Partial<Record<keyof ComponentInput, string[]>>;
};

function inputFrom(formData: FormData) {
  return {
    name: formData.get('name'),
    slug: formData.get('slug'),
    componentType: formData.get('componentType'),
    framework: formData.get('framework'),
    runtime: formData.get('runtime'),
    language: formData.get('language'),
    criticality: formData.get('criticality'),
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; cause?: unknown };
  return candidate.code === '23505' || isUniqueViolation(candidate.cause);
}

async function revalidateProject(projectId: string) {
  const [project] = await db
    .select({ slug: schema.projects.slug })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId));

  if (project) revalidatePath(`/projects/${project.slug}`);
}

export async function createComponent(
  projectId: string,
  _previousState: ComponentActionState,
  formData: FormData,
): Promise<ComponentActionState> {
  const session = await auth();
  if (!session) throw new Error('인증이 필요합니다.');

  const parsed = componentInputSchema.safeParse(inputFrom(formData));
  if (!parsed.success) {
    return {
      status: 'error',
      message: '입력값을 확인해 주세요.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    await db.insert(schema.components).values({
      projectId,
      ...parsed.data,
      framework: parsed.data.framework ?? null,
      runtime: parsed.data.runtime ?? null,
      language: parsed.data.language ?? null,
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        status: 'error',
        message: '이 프로젝트에서 이미 사용 중인 slug입니다.',
        fieldErrors: { slug: ['이 프로젝트에서 이미 사용 중인 slug입니다.'] },
      };
    }
    return { status: 'error', message: '구성요소를 저장하지 못했습니다.' };
  }

  await revalidateProject(projectId);
  return { status: 'success', message: '구성요소를 등록했습니다.' };
}

export async function updateComponent(
  id: string,
  _previousState: ComponentActionState,
  formData: FormData,
): Promise<ComponentActionState> {
  const session = await auth();
  if (!session) throw new Error('인증이 필요합니다.');

  const parsed = componentInputSchema.safeParse(inputFrom(formData));
  if (!parsed.success) {
    return {
      status: 'error',
      message: '입력값을 확인해 주세요.',
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  let projectId: string;
  try {
    const [updated] = await db
      .update(schema.components)
      .set({
        ...parsed.data,
        framework: parsed.data.framework ?? null,
        runtime: parsed.data.runtime ?? null,
        language: parsed.data.language ?? null,
        updatedAt: new Date(),
      })
      .where(eq(schema.components.id, id))
      .returning({ projectId: schema.components.projectId });

    if (!updated) return { status: 'error', message: '구성요소를 찾을 수 없습니다.' };
    projectId = updated.projectId;
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        status: 'error',
        message: '이 프로젝트에서 이미 사용 중인 slug입니다.',
        fieldErrors: { slug: ['이 프로젝트에서 이미 사용 중인 slug입니다.'] },
      };
    }
    return { status: 'error', message: '구성요소를 저장하지 못했습니다.' };
  }

  await revalidateProject(projectId);
  return { status: 'success', message: '구성요소를 수정했습니다.' };
}

export async function deleteComponent(id: string): Promise<void> {
  const session = await auth();
  if (!session) throw new Error('인증이 필요합니다.');

  const [deleted] = await db
    .delete(schema.components)
    .where(eq(schema.components.id, id))
    .returning({ projectId: schema.components.projectId });

  if (!deleted) throw new Error('구성요소를 찾을 수 없습니다.');
  await revalidateProject(deleted.projectId);
}
