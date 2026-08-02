import { randomUUID } from 'node:crypto';
import {
  deleteSnapshotImage,
  enqueueSnapshotCaptureTrailing,
  getProjectBySlug,
  getSnapshotState,
  resumeAutomaticSnapshot,
  saveManualSnapshot,
  schema,
  type Db,
  type ManualSnapshotInput,
  type ProjectSnapshotState,
} from '@deployhub/db';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { auth } from '../../../../../auth/config';
import {
  normalizeSnapshotUpload,
  type NormalizedSnapshotUpload,
} from '../../../../../lib/snapshot-upload';

export type SnapshotProject = {
  id: string;
  slug: string;
  snapshotMode: 'disabled' | 'automatic' | 'manual';
  snapshotUrl: string | null;
};

export type SnapshotRouteContext = {
  params: Promise<{ slug: string }>;
};

export type SnapshotCaptureRequest = {
  projectId: string;
  url: string;
  requestId: string;
};

export type SnapshotSettings = {
  mode: 'disabled' | 'automatic';
  url: string | null;
};

export type SnapshotRouteDependencies = {
  auth: () => Promise<unknown>;
  findProject: (database: Db, slug: string) => Promise<SnapshotProject | undefined>;
  getSnapshot: (database: Db, projectId: string) => Promise<
    Partial<ProjectSnapshotState> | undefined
  >;
  deleteImage: (database: Db, projectId: string) => Promise<void>;
  saveManual: (database: Db, input: ManualSnapshotInput) => Promise<void>;
  resumeAutomatic: (database: Db, projectId: string) => Promise<boolean>;
  enqueue: (database: Db, payload: SnapshotCaptureRequest) => Promise<boolean>;
  updateSettings: (
    database: Db,
    projectId: string,
    settings: SnapshotSettings,
  ) => Promise<boolean>;
  normalize: (file: File) => Promise<NormalizedSnapshotUpload>;
  revalidate: (slug: string) => void;
  randomUUID: () => string;
};

const defaultDependencies: SnapshotRouteDependencies = {
  auth: () => auth(),
  findProject: getProjectBySlug,
  getSnapshot: getSnapshotState,
  deleteImage: deleteSnapshotImage,
  saveManual: saveManualSnapshot,
  resumeAutomatic: resumeAutomaticSnapshot,
  enqueue: (database, payload) => enqueueSnapshotCaptureTrailing(database, {
    projectId: payload.projectId,
    payload,
    maxAttempts: 3,
  }),
  updateSettings: async (database, projectId, settings) => {
    const updated = await database
      .update(schema.projects)
      .set({
        snapshotMode: settings.mode,
        snapshotUrl: settings.url,
        updatedAt: new Date(),
      })
      .where(eq(schema.projects.id, projectId))
      .returning({ id: schema.projects.id });
    return updated.length > 0;
  },
  normalize: normalizeSnapshotUpload,
  revalidate: () => {
    revalidatePath('/');
    revalidatePath('/projects/[slug]', 'page');
  },
  randomUUID,
};

export function snapshotRouteDependencies(
  overrides: Partial<SnapshotRouteDependencies>,
): SnapshotRouteDependencies {
  return { ...defaultDependencies, ...overrides };
}

export type AuthorizedSnapshotProject =
  | { ok: true; project: SnapshotProject }
  | { ok: false; response: Response };

export async function authorizeSnapshotProject(
  database: Db,
  context: SnapshotRouteContext,
  dependencies: SnapshotRouteDependencies,
): Promise<AuthorizedSnapshotProject> {
  const session = await dependencies.auth();
  if (!session) {
    return {
      ok: false,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const { slug } = await context.params;
  const project = await dependencies.findProject(database, slug);
  if (!project) {
    return {
      ok: false,
      response: Response.json({ error: 'Not found' }, { status: 404 }),
    };
  }
  return { ok: true, project };
}

export function notFoundResponse(): Response {
  return Response.json({ error: 'Not found' }, { status: 404 });
}

export function revalidateSnapshotProject(
  dependencies: SnapshotRouteDependencies,
  slug: string,
): void {
  dependencies.revalidate(slug);
}
