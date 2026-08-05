'use server';

import { eq, isNull, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { nextTopDisplayOrder, schema } from '@deployhub/db';
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
    await db.transaction(async (tx) => {
      await tx.insert(schema.projects).values({
        ...parsed.data,
        description: parsed.data.description ?? null,
        owner: parsed.data.owner ?? null,
        repository: parsed.data.repository ?? null,
        archivedAt: parsed.data.status === 'archived' ? new Date() : null,
        displayOrder: await nextTopDisplayOrder(tx),
      });
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

export type ReorderProjectsResult = {
  status: 'success' | 'stale' | 'error';
};

const orderedIdsSchema = z.array(z.uuid()).min(1);

/**
 * 목록 전체 순서를 0..n-1 로 다시 부여한다.
 *
 * 쓰기 전에 아카이브되지 않은 프로젝트 id 집합이 요청과 정확히 같은지
 * 검사한다. 이게 없으면 다른 탭에서 Draft 를 승인한 뒤 낡은 배열로 저장할 때
 * 새 프로젝트가 순서에서 탈락한다.
 *
 * `updatedAt` 은 건드리지 않는다. 순서 변경은 프로젝트 내용 변경이 아니다.
 */
export async function reorderProjects(
  orderedIds: string[],
): Promise<ReorderProjectsResult> {
  const session = await auth();
  if (!session) throw new Error('인증이 필요합니다.');

  const parsed = orderedIdsSchema.safeParse(orderedIds);
  if (!parsed.success) return { status: 'error' };
  if (new Set(parsed.data).size !== parsed.data.length) {
    return { status: 'error' };
  }

  try {
    const applied = await db.transaction(async (tx) => {
      const current = await tx
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(isNull(schema.projects.archivedAt));

      const currentIds = new Set(current.map((row) => row.id));
      if (currentIds.size !== parsed.data.length) return false;
      if (parsed.data.some((id) => !currentIds.has(id))) return false;

      const positions = sql.join(
        parsed.data.map(
          (id, position) => sql`(${id}::uuid, ${position}::integer)`,
        ),
        sql`, `,
      );
      await tx.execute(sql`
        update ${schema.projects} as p
        set display_order = v.position
        from (values ${positions}) as v(id, position)
        where p.id = v.id
      `);

      return true;
    });

    if (!applied) return { status: 'stale' };
  } catch {
    return { status: 'error' };
  }

  revalidatePath('/');
  return { status: 'success' };
}
