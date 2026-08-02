import type { Db } from '@deployhub/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../../../auth/config', () => ({ auth: vi.fn() }));

import type {
  SnapshotProject,
  SnapshotRouteDependencies,
} from './route-utils';
import { createProjectSnapshotHandlers } from './route';
import { createSnapshotUploadHandler } from './upload/route';
import { createSnapshotCaptureHandler } from './capture/route';
import { createSnapshotResumeHandler } from './resume/route';
import {
  createSnapshotSettingsHandler,
  persistSnapshotSettings,
} from './settings/route';

const database = {} as Db;
const project = {
  id: 'project-id',
  slug: 'yield',
  snapshotMode: 'automatic' as const,
  snapshotUrl: 'https://yield.example.com/',
};
const image = Buffer.from('webp-image');
const checksum = 'a'.repeat(64);
const MAX_MULTIPART_BYTES = 6 * 1024 * 1024;

const mocks = {
  auth: vi.fn(),
  findProject: vi.fn(),
  getSnapshot: vi.fn(),
  deleteImage: vi.fn(),
  saveManual: vi.fn(),
  resumeAutomatic: vi.fn(),
  enqueue: vi.fn(),
  updateSettings: vi.fn(),
  normalize: vi.fn(),
  revalidate: vi.fn(),
  randomUUID: vi.fn(),
};

function dependencies(): Partial<SnapshotRouteDependencies> {
  return mocks;
}

function context(slug = 'yield') {
  return { params: Promise.resolve({ slug }) };
}

function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://deployhub.test${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function fileOfSize(size: number, name: string): File {
  return new File([new ArrayBuffer(size)], name, { type: 'image/png' });
}

function asArrayBuffer(buffer: Buffer): ArrayBuffer {
  const result = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(result).set(buffer);
  return result;
}

function oversizedMultipartBody(kind: 'files' | 'text'): {
  boundary: string;
  body: ArrayBuffer;
} {
  const boundary = 'snapshot-test-boundary';
  const chunks = kind === 'files'
    ? [
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="first.png"\r\nContent-Type: image/png\r\n\r\n`),
      Buffer.alloc(4_000_000),
      Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="second"; filename="second.png"\r\nContent-Type: image/png\r\n\r\n`),
      Buffer.alloc(3_000_000),
    ]
    : [
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="screen.png"\r\nContent-Type: image/png\r\n\r\nx\r\n--${boundary}\r\nContent-Disposition: form-data; name="notes"\r\n\r\n`),
      Buffer.alloc(MAX_MULTIPART_BYTES, 120),
    ];
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { boundary, body: asArrayBuffer(Buffer.concat(chunks)) };
}

function handlers() {
  const root = createProjectSnapshotHandlers(database, dependencies());
  return [
    ['GET', root.GET, new Request('http://deployhub.test/api/projects/yield/snapshot')],
    ['DELETE', root.DELETE, new Request('http://deployhub.test/api/projects/yield/snapshot', { method: 'DELETE' })],
    ['upload', createSnapshotUploadHandler(database, dependencies()), new Request('http://deployhub.test/api/projects/yield/snapshot/upload', { method: 'POST' })],
    ['capture', createSnapshotCaptureHandler(database, dependencies()), jsonRequest('/api/projects/yield/snapshot/capture', {})],
    ['resume', createSnapshotResumeHandler(database, dependencies()), jsonRequest('/api/projects/yield/snapshot/resume', {})],
    ['settings', createSnapshotSettingsHandler(database, dependencies()), jsonRequest('/api/projects/yield/snapshot/settings', { mode: 'disabled', url: null })],
  ] as const;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: 'user-id' } });
  mocks.findProject.mockResolvedValue(project);
  mocks.getSnapshot.mockResolvedValue({
    projectId: project.id,
    imageData: image,
    contentType: 'image/webp',
    width: 1440,
    height: 900,
    checksum,
  });
  mocks.deleteImage.mockResolvedValue(undefined);
  mocks.saveManual.mockResolvedValue(undefined);
  mocks.resumeAutomatic.mockResolvedValue(true);
  mocks.enqueue.mockResolvedValue(true);
  mocks.updateSettings.mockResolvedValue(true);
  mocks.normalize.mockResolvedValue({
    imageData: image,
    contentType: 'image/webp',
    width: 1440,
    height: 900,
    checksum,
  });
  mocks.randomUUID.mockReturnValue('request-uuid');
});

describe('snapshot route authentication and lookup', () => {
  it('returns 401 before reading request bodies or the database on every route', async () => {
    mocks.auth.mockResolvedValue(null);

    for (const [name, handler, request] of handlers()) {
      const response = await handler(request, context());
      expect(response.status, name).toBe(401);
    }
    expect(mocks.findProject).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown slug on every route', async () => {
    mocks.findProject.mockResolvedValue(undefined);

    for (const [name, handler, request] of handlers()) {
      const response = await handler(request, context('missing'));
      expect(response.status, name).toBe(404);
    }
  });
});

describe('GET /snapshot', () => {
  it('serves the private WebP with a quoted checksum ETag', async () => {
    const response = await createProjectSnapshotHandlers(
      database,
      dependencies(),
    ).GET(new Request('http://deployhub.test/api/projects/yield/snapshot'), context());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('etag')).toBe(`"${checksum}"`);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(image);
  });

  it('returns a bodyless 304 when If-None-Match identifies the image', async () => {
    const response = await createProjectSnapshotHandlers(
      database,
      dependencies(),
    ).GET(new Request('http://deployhub.test/api/projects/yield/snapshot', {
      headers: { 'if-none-match': `"${checksum}"` },
    }), context());

    expect(response.status).toBe(304);
    expect((await response.arrayBuffer()).byteLength).toBe(0);
    expect(response.headers.get('etag')).toBe(`"${checksum}"`);
  });

  it('returns 404 when no current image exists', async () => {
    mocks.getSnapshot.mockResolvedValue({ imageData: null, checksum: null });
    const response = await createProjectSnapshotHandlers(
      database,
      dependencies(),
    ).GET(new Request('http://deployhub.test/api/projects/yield/snapshot'), context());

    expect(response.status).toBe(404);
  });
});

describe('DELETE /snapshot', () => {
  it('clears only the current image through the repository and revalidates', async () => {
    const response = await createProjectSnapshotHandlers(
      database,
      dependencies(),
    ).DELETE(new Request('http://deployhub.test/api/projects/yield/snapshot', {
      method: 'DELETE',
    }), context());

    expect(response.status).toBe(204);
    expect(mocks.deleteImage).toHaveBeenCalledWith(database, project.id);
    expect(mocks.revalidate).toHaveBeenCalledWith('yield');
  });
});

describe('POST /snapshot/upload', () => {
  it('normalizes a multipart file and atomically pins the manual image', async () => {
    const body = new FormData();
    const file = new File([Buffer.from('png')], 'screen.png', { type: 'image/png' });
    body.set('file', file);
    const request = new Request('http://deployhub.test/api/projects/yield/snapshot/upload', {
      method: 'POST',
      body,
    });

    const response = await createSnapshotUploadHandler(
      database,
      dependencies(),
    )(request, context());

    expect(response.status).toBe(201);
    expect(mocks.normalize).toHaveBeenCalledWith(expect.objectContaining({
      name: 'screen.png',
      type: 'image/png',
      size: 3,
    }));
    expect(mocks.saveManual).toHaveBeenCalledWith(database, {
      projectId: project.id,
      imageData: image,
      width: 1440,
      height: 900,
      checksum,
    });
    expect(mocks.revalidate).toHaveBeenCalledWith('yield');
  });

  it('rejects multipart bodies without a file', async () => {
    const response = await createSnapshotUploadHandler(
      database,
      dependencies(),
    )(new Request('http://deployhub.test/api/projects/yield/snapshot/upload', {
      method: 'POST',
      body: new FormData(),
    }), context());
    expect(response.status).toBe(400);
  });

  it('rejects Content-Length above the whole multipart cap before reading', async () => {
    const stream = new ReadableStream<Uint8Array>();
    const request = new Request('http://deployhub.test/api/projects/yield/snapshot/upload', {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=unused',
        'content-length': String(MAX_MULTIPART_BYTES + 1),
      },
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    const cancel = vi.spyOn(request.body!, 'cancel');

    const response = await createSnapshotUploadHandler(
      database,
      dependencies(),
    )(request, context());

    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
    expect(mocks.normalize).not.toHaveBeenCalled();
  });

  it('bounds chunked bodies even when Content-Length lies and cancels the reader', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_MULTIPART_BYTES));
        controller.enqueue(new Uint8Array(1));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request('http://deployhub.test/api/projects/yield/snapshot/upload', {
      method: 'POST',
      headers: {
        'content-type': 'multipart/form-data; boundary=unused',
        'content-length': '1',
      },
      body: stream,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });

    const response = await createSnapshotUploadHandler(
      database,
      dependencies(),
    )(request, context());

    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(stream.locked).toBe(false);
  });

  it('rejects aggregate multipart bytes across multiple files', async () => {
    const multipart = oversizedMultipartBody('files');

    const response = await createSnapshotUploadHandler(
      database,
      dependencies(),
    )(new Request('http://deployhub.test/api/projects/yield/snapshot/upload', {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${multipart.boundary}`,
      },
      body: multipart.body,
    }), context());

    expect(response.status).toBe(413);
    expect(mocks.normalize).not.toHaveBeenCalled();
  });

  it('rejects aggregate multipart bytes from oversized text fields', async () => {
    const multipart = oversizedMultipartBody('text');

    const response = await createSnapshotUploadHandler(
      database,
      dependencies(),
    )(new Request('http://deployhub.test/api/projects/yield/snapshot/upload', {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${multipart.boundary}`,
      },
      body: multipart.body,
    }), context());

    expect(response.status).toBe(413);
    expect(mocks.normalize).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed multipart after bounded reading', async () => {
    const response = await createSnapshotUploadHandler(
      database,
      dependencies(),
    )(new Request('http://deployhub.test/api/projects/yield/snapshot/upload', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=broken' },
      body: 'not-a-multipart-body',
    }), context());

    expect(response.status).toBe(400);
  });

  it('returns a safe 500 for unexpected normalizer failures', async () => {
    mocks.normalize.mockRejectedValue(new Error('https://secret.example/token'));
    const body = new FormData();
    body.set('file', fileOfSize(1, 'screen.png'));
    const response = await createSnapshotUploadHandler(
      database,
      dependencies(),
    )(new Request('http://deployhub.test/api/projects/yield/snapshot/upload', {
      method: 'POST',
      body,
    }), context());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'upload_failed' });
  });
});

describe('POST /snapshot/capture', () => {
  it('enqueues automatic mode with a generated request UUID', async () => {
    const response = await createSnapshotCaptureHandler(
      database,
      dependencies(),
    )(jsonRequest('/api/projects/yield/snapshot/capture', {}), context());

    expect(response.status).toBe(202);
    expect(mocks.enqueue).toHaveBeenCalledWith(database, {
      projectId: project.id,
      url: project.snapshotUrl,
      requestId: 'request-uuid',
    });
    expect(mocks.revalidate).toHaveBeenCalledWith('yield');
  });

  it.each(['disabled', 'manual'] as const)('rejects %s mode', async (mode) => {
    mocks.findProject.mockResolvedValue({ ...project, snapshotMode: mode });
    const response = await createSnapshotCaptureHandler(
      database,
      dependencies(),
    )(jsonRequest('/api/projects/yield/snapshot/capture', {}), context());
    expect(response.status).toBe(409);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});

describe('POST /snapshot/resume', () => {
  it('resumes automatic mode and enqueues immediately without deleting the old image', async () => {
    mocks.findProject
      .mockResolvedValueOnce({ ...project, snapshotMode: 'manual' })
      .mockResolvedValueOnce(project);
    const response = await createSnapshotResumeHandler(
      database,
      dependencies(),
    )(jsonRequest('/api/projects/yield/snapshot/resume', {}), context());

    expect(response.status).toBe(202);
    expect(mocks.resumeAutomatic).toHaveBeenCalledWith(database, project.id);
    expect(mocks.enqueue).toHaveBeenCalledWith(database, {
      projectId: project.id,
      url: project.snapshotUrl,
      requestId: 'request-uuid',
    });
    expect(mocks.deleteImage).not.toHaveBeenCalled();
    expect(mocks.saveManual).not.toHaveBeenCalled();
  });

  it('re-reads state to distinguish a missing URL when resume returns false', async () => {
    mocks.findProject
      .mockResolvedValueOnce({ ...project, snapshotMode: 'manual' })
      .mockResolvedValueOnce({ ...project, snapshotMode: 'manual', snapshotUrl: null });
    mocks.resumeAutomatic.mockResolvedValue(false);
    const response = await createSnapshotResumeHandler(
      database,
      dependencies(),
    )(jsonRequest('/api/projects/yield/snapshot/resume', {}), context());

    expect(response.status).toBe(400);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
});

describe('POST /snapshot/settings', () => {
  it.each([
    { mode: 'manual', url: 'https://example.com/' },
    { mode: 'automatic', url: null },
    { mode: 'automatic', url: 'ftp://example.com/' },
    { mode: 'automatic', url: 'https://user:secret@example.com/' },
    { mode: 'automatic', url: 'http://example.com:443/' },
    { mode: 'automatic', url: 'https://example.com:80/' },
  ])('rejects invalid settings %#', async (body) => {
    const response = await createSnapshotSettingsHandler(
      database,
      dependencies(),
    )(jsonRequest('/api/projects/yield/snapshot/settings', body), context());
    expect(response.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it.each([
    [{ mode: 'disabled' }, { mode: 'disabled', url: null }],
    [{ mode: 'disabled', url: null }, { mode: 'disabled', url: null }],
    [
      { mode: 'automatic', url: 'https://example.com:443/app' },
      { mode: 'automatic', url: 'https://example.com/app' },
    ],
    [
      { mode: 'automatic', url: 'http://example.com:80/app' },
      { mode: 'automatic', url: 'http://example.com/app' },
    ],
  ] as const)('updates valid settings %#', async (body, expected) => {
    const response = await createSnapshotSettingsHandler(
      database,
      dependencies(),
    )(jsonRequest('/api/projects/yield/snapshot/settings', body), context());

    expect(response.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      database,
      project,
      expected,
      'request-uuid',
    );
    expect(mocks.revalidate).toHaveBeenCalledWith('yield');
  });
});

describe('atomic snapshot settings persistence', () => {
  function transactionalDatabase(initial: SnapshotProject = project) {
    let committed: SnapshotProject = { ...initial };
    const tx = {
      select: vi.fn(() => ({
        from: () => ({
          where: () => ({
            for: async () => [{
              snapshotMode: staged.snapshotMode,
              snapshotUrl: staged.snapshotUrl,
            }],
          }),
        }),
      })),
      update: vi.fn(() => ({
        set: (values: Record<string, unknown>) => ({
          where: () => ({
            returning: async () => {
              Object.assign(staged, values);
              return [{ id: initial.id }];
            },
          }),
        }),
      })),
    };
    let staged: SnapshotProject = { ...committed };
    const fakeDb = {
      transaction: async (callback: (transaction: typeof tx) => Promise<boolean>) => {
        staged = { ...committed };
        const result = await callback(tx);
        committed = { ...staged };
        return result;
      },
    } as unknown as Db;
    return { fakeDb, tx, current: () => committed };
  }

  it.each([
    ['disabled to automatic', { ...project, snapshotMode: 'disabled' as const }],
    ['manual to automatic', { ...project, snapshotMode: 'manual' as const }],
    ['automatic URL change', { ...project, snapshotUrl: 'https://old.example.com/' }],
  ])('updates and coalesces capture in one transaction for %s', async (_name, previous) => {
    const state = transactionalDatabase(previous);
    const coalesce = vi.fn().mockResolvedValue(true);
    await persistSnapshotSettings(state.fakeDb, previous, {
      mode: 'automatic',
      url: 'https://new.example.com/',
    }, 'settings-request-id', { coalesce });

    expect(coalesce).toHaveBeenCalledWith(state.tx, {
      projectId: project.id,
      payload: {
        projectId: project.id,
        url: 'https://new.example.com/',
        requestId: 'settings-request-id',
      },
      maxAttempts: 3,
    });
    expect(state.current()).toMatchObject({
      snapshotMode: 'automatic',
      snapshotUrl: 'https://new.example.com/',
    });
  });

  it.each([
    ['same automatic settings', project, { mode: 'automatic' as const, url: project.snapshotUrl }],
    ['disable automatic', project, { mode: 'disabled' as const, url: project.snapshotUrl }],
  ])('does not enqueue for %s', async (_name, previous, settings) => {
    const state = transactionalDatabase(previous);
    const coalesce = vi.fn();
    await persistSnapshotSettings(
      state.fakeDb,
      previous,
      settings,
      'settings-request-id',
      { coalesce },
    );
    expect(coalesce).not.toHaveBeenCalled();
  });

  it('rolls back the settings update when enqueue fails', async () => {
    const previous = { ...project, snapshotMode: 'disabled' as const };
    const state = transactionalDatabase(previous);
    const coalesce = vi.fn().mockRejectedValue(new Error('enqueue failed'));

    await expect(persistSnapshotSettings(state.fakeDb, previous, {
      mode: 'automatic',
      url: project.snapshotUrl,
    }, 'settings-request-id', { coalesce })).rejects.toThrow('enqueue failed');
    expect(state.current()).toEqual(previous);
  });

  it('decides whether to enqueue from locked transaction state, not stale route state', async () => {
    const staleRouteProject = project;
    const currentDatabaseProject = {
      ...project,
      snapshotUrl: 'https://changed-concurrently.example.com/',
    };
    const state = transactionalDatabase(currentDatabaseProject);
    const coalesce = vi.fn().mockResolvedValue(true);

    await persistSnapshotSettings(state.fakeDb, staleRouteProject, {
      mode: 'automatic',
      url: project.snapshotUrl,
    }, 'settings-request-id', { coalesce });

    expect(coalesce).toHaveBeenCalledOnce();
  });
});
