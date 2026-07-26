import {
  consumeToken,
  getProjectBySlug,
  insertDraft,
  type Db,
} from '@deployhub/db';
import {
  diffManifest,
  MANIFEST_VERSION,
  parseManifest,
} from '@deployhub/manifest';
import { db } from '../../../../lib/db';
import { bearerToken } from '../../../../lib/token';

const MAX_BODY_BYTES = 256 * 1024;

type SubmissionBody = {
  manifestYaml: string;
  fieldSources: Record<string, unknown>;
};

async function readRequestBody(request: Request): Promise<string | null> {
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return null;
  }

  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function parseSubmissionBody(body: string): SubmissionBody | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      typeof parsed !== 'object'
      || parsed === null
      || typeof (parsed as { manifestYaml?: unknown }).manifestYaml !== 'string'
    ) {
      return undefined;
    }

    const fieldSources = (parsed as { fieldSources?: unknown }).fieldSources;
    return {
      manifestYaml: (parsed as { manifestYaml: string }).manifestYaml,
      fieldSources:
        typeof fieldSources === 'object' && fieldSources !== null
          ? fieldSources as Record<string, unknown>
          : {},
    };
  } catch {
    return undefined;
  }
}

export function createProjectDraftHandler(database: Db) {
  return async function postProjectDraft(request: Request): Promise<Response> {
    const rawToken = bearerToken(request);
    if (!rawToken) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawBody = await readRequestBody(request);
    if (rawBody === null) {
      return Response.json(
        { error: 'Request body exceeds the 256KB limit' },
        { status: 413 },
      );
    }

    const submission = parseSubmissionBody(rawBody);
    if (!submission) {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const consumed = await consumeToken(database, rawToken);
    if (!consumed.ok || consumed.scope !== 'project:draft:create') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = parseManifest(submission.manifestYaml);
    if (!parsed.ok) {
      const draft = await insertDraft(database, {
        projectId: null,
        manifestVersion: MANIFEST_VERSION,
        manifestYaml: submission.manifestYaml,
        fieldSources: submission.fieldSources,
        sourceType: 'cli',
        submittedByType: 'token',
        submittedById: consumed.tokenId,
        status: 'validation_failed',
        validationResult: {
          ok: false,
          errors: parsed.errors,
        },
        diff: null,
      });

      return Response.json(
        {
          id: draft.id,
          status: draft.status,
          url: `/drafts/${draft.id}`,
        },
        { status: 201 },
      );
    }

    const repository = parsed.manifest.spec.repository?.slug;
    if (
      consumed.repositoryConstraint
      && consumed.repositoryConstraint !== repository
    ) {
      return Response.json({ error: 'Repository not allowed' }, { status: 403 });
    }

    const current = await getProjectBySlug(
      database,
      parsed.manifest.metadata.slug,
    );
    const draft = await insertDraft(database, {
      projectId: current?.id ?? null,
      manifestVersion: MANIFEST_VERSION,
      manifestYaml: submission.manifestYaml,
      fieldSources: submission.fieldSources,
      sourceType: 'cli',
      submittedByType: 'token',
      submittedById: consumed.tokenId,
      status: 'pending_review',
      validationResult: {
        ok: true,
        warnings: parsed.warnings,
      },
      diff: diffManifest(parsed.manifest, current),
    });

    return Response.json(
      {
        id: draft.id,
        status: draft.status,
        url: `/drafts/${draft.id}`,
      },
      { status: 201 },
    );
  };
}

export const POST = createProjectDraftHandler(db);
