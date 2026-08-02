import type { Db } from '@deployhub/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../../../auth/config', () => ({ auth: vi.fn() }));

import type { SnapshotRouteDependencies } from './route-utils';
import { createProjectSnapshotHandlers } from './route';
import { createSnapshotUploadHandler } from './upload/route';
import { createSnapshotCaptureHandler } from './capture/route';
import { createSnapshotResumeHandler } from './resume/route';
import { createSnapshotSettingsHandler } from './settings/route';

const database = {} as Db;
const project = {
  id: 'project-id',
  slug: 'yield',
  snapshotMode: 'automatic' as const,
  snapshotUrl: 'https://yield.example.com/',
};
const image = Buffer.from('webp-image');
const checksum = 'a'.repeat(64);

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
    expect(mocks.updateSettings).toHaveBeenCalledWith(database, project.id, expected);
    expect(mocks.revalidate).toHaveBeenCalledWith('yield');
  });
});
