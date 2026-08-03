'use server';

import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import {
  enqueueUnique,
  linkDeclaredResources,
  schema,
} from '@deployhub/db';
import { parseManifest } from '@deployhub/manifest';
import { auth } from '../auth/config';
import { db } from '../lib/db';

type ApprovedDraftRefreshPlan = {
  accounts: Array<{ id: string; provider: 'vercel' | 'supabase' }>;
  docker: boolean;
};

type ApprovedDraftResult = ApprovedDraftRefreshPlan & {
  projectSlug: string;
};

type EnqueueRefresh = typeof enqueueUnique;

export async function enqueueApprovedDraftRefreshes(
  plan: ApprovedDraftRefreshPlan,
  enqueueRefresh: EnqueueRefresh = (database, options) => (
    enqueueUnique(database, options)
  ),
  logError: (message: string) => void = (message) => console.error(message),
): Promise<void> {
  const requests: Array<{
    type: string;
    dedupeKey: string;
    payload: Record<string, unknown>;
  }> = plan.accounts.map((account) => ({
    type: `${account.provider}.sync`,
    dedupeKey: `${account.provider}:${account.id}`,
    payload: { accountId: account.id },
  }));
  if (plan.docker) {
    requests.push({
      type: 'docker.sync',
      dedupeKey: 'docker:global',
      payload: {},
    });
  }
  for (const request of requests) {
    try {
      await enqueueRefresh(db, request);
    } catch {
      logError(`[draft] ${request.type} refresh job 등록 실패`);
    }
  }
}

function componentFieldSources(
  sources: unknown,
  componentName: string,
): Record<string, unknown> {
  if (typeof sources !== 'object' || sources === null) return {};
  const component = (sources as Record<string, unknown>)[componentName];
  return typeof component === 'object' && component !== null
    ? component as Record<string, unknown>
    : {};
}

export async function approveDraft(id: string): Promise<void> {
  const session = await auth();
  const reviewerId = session?.user?.id;
  if (!reviewerId) throw new Error('인증이 필요합니다.');

  const approved = await db.transaction(async (tx) => {
    const [draft] = await tx
      .update(schema.projectDrafts)
      .set({
        status: 'approved',
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
      })
      .where(and(
        eq(schema.projectDrafts.id, id),
        eq(schema.projectDrafts.status, 'pending_review'),
      ))
      .returning();

    if (!draft) {
      throw new Error('승인할 수 없는 Draft입니다.');
    }

    const parsed = parseManifest(draft.manifestYaml);
    if (!parsed.ok) {
      throw new Error('유효하지 않은 manifest는 승인할 수 없습니다.');
    }
    const manifest = parsed.manifest;

    let projectId = draft.projectId;
    if (!projectId) {
      const [existing] = await tx
        .select({ id: schema.projects.id })
        .from(schema.projects)
        .where(eq(schema.projects.slug, manifest.metadata.slug));
      projectId = existing?.id ?? null;
    }

    const projectValues = {
      name: manifest.metadata.name,
      slug: manifest.metadata.slug,
      description: manifest.metadata.description ?? null,
      lifecycle: manifest.spec.lifecycle,
      importance: manifest.spec.importance ?? 3,
      owner: manifest.spec.owner ?? null,
      repository: manifest.spec.repository?.slug ?? null,
      updatedAt: new Date(),
    };

    if (projectId) {
      const [updated] = await tx
        .update(schema.projects)
        .set(projectValues)
        .where(eq(schema.projects.id, projectId))
        .returning({ id: schema.projects.id });
      if (!updated) throw new Error('프로젝트를 찾을 수 없습니다.');
    } else {
      const [created] = await tx
        .insert(schema.projects)
        .values(projectValues)
        .returning({ id: schema.projects.id });
      if (!created) throw new Error('프로젝트를 만들지 못했습니다.');
      projectId = created.id;
    }

    for (const component of manifest.spec.components) {
      const values = {
        projectId,
        name: component.name,
        slug: component.name,
        componentType: component.type,
        framework: component.framework ?? null,
        runtime: component.runtime ?? null,
        language: component.language ?? null,
        criticality: component.criticality ?? 3,
        provider: component.provider ?? null,
        externalRef: component.externalRef ?? null,
        containerName: component.container ?? null,
        url: component.url ?? null,
        healthUrl: component.healthUrl ?? null,
        fieldSources: componentFieldSources(
          draft.fieldSources,
          component.name,
        ),
        updatedAt: new Date(),
      };
      await tx
        .insert(schema.components)
        .values(values)
        .onConflictDoUpdate({
          target: [
            schema.components.projectId,
            schema.components.slug,
          ],
          set: {
            name: values.name,
            componentType: values.componentType,
            framework: values.framework,
            runtime: values.runtime,
            language: values.language,
            criticality: values.criticality,
            provider: values.provider,
            externalRef: values.externalRef,
            containerName: values.containerName,
            url: values.url,
            healthUrl: values.healthUrl,
            fieldSources: values.fieldSources,
            updatedAt: values.updatedAt,
          },
        });
    }

    await tx
      .delete(schema.domains)
      .where(eq(schema.domains.projectId, projectId));
    const domains = manifest.spec.domains ?? [];
    if (domains.length > 0) {
      await tx.insert(schema.domains).values(domains.map((domain) => ({
        projectId,
        domain: domain.domain,
        environment: domain.environment,
      })));
    }

    for (const provider of ['vercel', 'docker', 'supabase'] as const) {
      await linkDeclaredResources(tx, { provider });
    }
    const declaredProviders = new Set(
      manifest.spec.components.flatMap((component) => (
        component.provider === 'vercel' || component.provider === 'supabase'
          ? [component.provider]
          : []
      )),
    );
    const accounts = declaredProviders.size === 0
      ? []
      : await tx
        .select({
          id: schema.providerAccounts.id,
          provider: schema.providerAccounts.provider,
        })
        .from(schema.providerAccounts)
        .where(inArray(
          schema.providerAccounts.provider,
          [...declaredProviders],
        ));
    return {
      accounts: accounts.filter((account): account is {
        id: string;
        provider: 'vercel' | 'supabase';
      } => account.provider === 'vercel' || account.provider === 'supabase'),
      docker: manifest.spec.components.some(
        (component) => component.container !== undefined,
      ),
      projectSlug: manifest.metadata.slug,
    } satisfies ApprovedDraftResult;
  });

  await enqueueApprovedDraftRefreshes(approved);

  revalidatePath('/settings/drafts');
  revalidatePath(`/settings/drafts/${id}`);
  revalidatePath('/projects');
  revalidatePath(`/projects/${approved.projectSlug}`);
  revalidatePath('/settings/providers');
}

export async function rejectDraft(id: string): Promise<void> {
  const session = await auth();
  const reviewerId = session?.user?.id;
  if (!reviewerId) throw new Error('인증이 필요합니다.');

  const [draft] = await db
    .update(schema.projectDrafts)
    .set({
      status: 'rejected',
      reviewedBy: reviewerId,
      reviewedAt: new Date(),
    })
    .where(and(
      eq(schema.projectDrafts.id, id),
      eq(schema.projectDrafts.status, 'pending_review'),
    ))
    .returning({ id: schema.projectDrafts.id });

  if (!draft) throw new Error('거부할 수 없는 Draft입니다.');
  revalidatePath('/settings/drafts');
  revalidatePath(`/settings/drafts/${id}`);
}
