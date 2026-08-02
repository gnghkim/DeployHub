import { createHash, randomUUID } from 'node:crypto';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { eq } from 'drizzle-orm';
import { startTestDb } from '@deployhub/db/test/helpers/pg.js';
import {
  getSnapshotState,
  markSnapshotPending,
  saveAutomaticSnapshot,
  saveManualSnapshot,
  schema,
  type Db,
  type JobRecord,
} from '@deployhub/db';
import {
  createSnapshotCaptureHandler,
  enqueueSnapshotCapture,
  type SnapshotCapturePayload,
} from './snapshot-capture';
import { createRunner } from '../runner';

const SNAPSHOT_URL = 'https://project.example/app?private=value';
const SNAPSHOTTER_URL = 'http://snapshotter.internal:3001/base?ignored=yes';
const IMAGE = Buffer.from('valid-webp-image');
const MAX_IMAGE_BYTES = 1_500_000;

let db: Db;
let stop: () => Promise<void>;
let slugSequence = 0;

beforeAll(async () => {
  const started = await startTestDb();
  db = started.db;
  stop = started.stop;
}, 120_000);

afterAll(async () => {
  await stop();
});

beforeEach(async () => {
  await db.delete(schema.deployments);
  await db.delete(schema.projects);
  await db.delete(schema.jobs);
});

async function insertProject(overrides: {
  snapshotMode?: 'automatic' | 'manual' | 'disabled';
  snapshotUrl?: string | null;
} = {}): Promise<string> {
  slugSequence += 1;
  const [project] = await db
    .insert(schema.projects)
    .values({
      name: `Snapshot ${slugSequence}`,
      slug: `snapshot-${slugSequence}`,
      snapshotMode: overrides.snapshotMode ?? 'automatic',
      snapshotUrl: overrides.snapshotUrl === undefined
        ? SNAPSHOT_URL
        : overrides.snapshotUrl,
    })
    .returning({ id: schema.projects.id });
  return project!.id;
}

function job(
  projectId: string,
  overrides: Partial<SnapshotCapturePayload> = {},
): JobRecord {
  return {
    id: randomUUID(),
    type: 'snapshot.capture',
    payload: {
      projectId,
      url: SNAPSHOT_URL,
      ...overrides,
    },
    attempts: 1,
    maxAttempts: 3,
  };
}

function successResponse(
  body: Buffer | ReadableStream<Uint8Array> = IMAGE,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'image/webp',
      'content-length': String(IMAGE.byteLength),
      'x-image-width': '1440',
      'x-image-height': '900',
      ...headers,
    },
  });
}

function errorResponse(
  code: string,
  status = 500,
): Response {
  return new Response(JSON.stringify({ error: { code, message: 'not trusted' } }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('snapshot capture enqueue', () => {
  it('coalesces active jobs per project while allowing different projects', async () => {
    const firstProjectId = randomUUID();
    const secondProjectId = randomUUID();

    await expect(enqueueSnapshotCapture(db, {
      projectId: firstProjectId,
      url: 'https://first.example',
      requestId: 'request-one',
    })).resolves.toBe(true);
    await expect(enqueueSnapshotCapture(db, {
      projectId: firstProjectId,
      url: 'https://changed.example',
    })).resolves.toBe(false);
    await expect(enqueueSnapshotCapture(db, {
      projectId: secondProjectId,
      url: 'https://second.example',
    })).resolves.toBe(true);

    const rows = await db.select().from(schema.jobs);
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'snapshot.capture',
        dedupeKey: `snapshot:${firstProjectId}`,
        payload: {
          projectId: firstProjectId,
          url: 'https://changed.example',
        },
        maxAttempts: 3,
      }),
      expect.objectContaining({
        dedupeKey: `snapshot:${secondProjectId}`,
      }),
    ]));
  });
});

describe('snapshot capture handler', () => {
  it('posts the fixed request and persists image metadata, checksum, and deployment', async () => {
    const projectId = await insertProject();
    const [deployment] = await db
      .insert(schema.deployments)
      .values({
        projectId,
        provider: 'vercel',
        environment: 'production',
        externalDeploymentId: 'snapshot-deployment',
        status: 'ready',
      })
      .returning({ id: schema.deployments.id });
    const fetchFn = vi.fn().mockResolvedValue(successResponse());

    await createSnapshotCaptureHandler(db, SNAPSHOTTER_URL, {
      fetch: fetchFn,
    })(job(projectId, {
      deploymentId: deployment!.id,
      requestId: 'request-secret',
    }));

    expect(fetchFn).toHaveBeenCalledOnce();
    const [requestUrl, init] = fetchFn.mock.calls[0]!;
    expect(requestUrl).toBe('http://snapshotter.internal:3001/capture');
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: SNAPSHOT_URL,
        viewport: { width: 1440, height: 900 },
      }),
    });
    expect(init.credentials).toBeUndefined();
    expect(init.headers).not.toHaveProperty('authorization');
    expect(init.headers).not.toHaveProperty('cookie');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(await getSnapshotState(db, projectId)).toMatchObject({
      imageData: IMAGE,
      contentType: 'image/webp',
      width: 1440,
      height: 900,
      source: 'automatic',
      sourceUrl: SNAPSHOT_URL,
      deploymentId: deployment!.id,
      checksum: createHash('sha256').update(IMAGE).digest('hex'),
      lastAttemptStatus: 'success',
      lastError: null,
    });
  });

  it('guarantees a trailing job after save and before runner completion', async () => {
    const projectId = await insertProject();
    await enqueueSnapshotCapture(db, { projectId, url: SNAPSHOT_URL });
    const terminalSave = deferred<void>();
    const allowCompletion = deferred<void>();
    const captureHandler = createSnapshotCaptureHandler(db, SNAPSHOTTER_URL, {
      fetch: vi.fn().mockResolvedValue(successResponse()),
    });
    const runner = createRunner(db, {
      'snapshot.capture': async (captureJob) => {
        await captureHandler(captureJob);
        terminalSave.resolve(undefined);
        await allowCompletion.promise;
      },
    }, 'snapshot-terminal-race-worker');
    const running = runner.runOnce();
    await terminalSave.promise;
    expect(await getSnapshotState(db, projectId)).toMatchObject({
      source: 'automatic',
      sourceUrl: SNAPSHOT_URL,
      lastAttemptStatus: 'success',
    });

    const latestUrl = 'https://terminal-race.example/app';
    await db
      .update(schema.projects)
      .set({ snapshotUrl: latestUrl })
      .where(eq(schema.projects.id, projectId));
    await expect(enqueueSnapshotCapture(db, {
      projectId,
      url: latestUrl,
      requestId: 'terminal-race-request',
    })).resolves.toBe(true);
    allowCompletion.resolve(undefined);

    await expect(running).resolves.toEqual({
      claimed: 1,
      succeeded: 1,
      failed: 0,
    });
    expect(await db.select().from(schema.jobs)).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'succeeded', dedupeKey: null }),
      expect.objectContaining({
        status: 'pending',
        dedupeKey: `snapshot:${projectId}`,
        payload: expect.objectContaining({ url: latestUrl }),
      }),
    ]));
  });

  it.each([
    ['disabled mode', { snapshotMode: 'disabled' as const }],
    ['manual mode', { snapshotMode: 'manual' as const }],
    ['missing project URL', { snapshotUrl: null }],
    ['changed project URL', { snapshotUrl: 'https://new.example/app' }],
  ])('completes without a request for %s', async (_name, projectOptions) => {
    const projectId = await insertProject(projectOptions);
    const fetchFn = vi.fn();

    await expect(createSnapshotCaptureHandler(db, SNAPSHOTTER_URL, {
      fetch: fetchFn,
    })(job(projectId))).resolves.toBeUndefined();

    expect(fetchFn).not.toHaveBeenCalled();
    expect(await getSnapshotState(db, projectId)).toBeUndefined();
  });

  it('does not trail a running job after automatic mode is disabled', async () => {
    const projectId = await insertProject();
    await enqueueSnapshotCapture(db, { projectId, url: SNAPSHOT_URL });
    await db
      .update(schema.projects)
      .set({ snapshotMode: 'disabled' })
      .where(eq(schema.projects.id, projectId));
    const fetchFn = vi.fn();
    const runner = createRunner(db, {
      'snapshot.capture': createSnapshotCaptureHandler(db, SNAPSHOTTER_URL, {
        fetch: fetchFn,
      }),
    }, 'snapshot-disabled-worker');

    await expect(runner.runOnce()).resolves.toEqual({
      claimed: 1,
      succeeded: 1,
      failed: 0,
    });

    expect(fetchFn).not.toHaveBeenCalled();
    expect(await getSnapshotState(db, projectId)).toBeUndefined();
    expect(await db.select().from(schema.jobs)).toEqual([
      expect.objectContaining({ status: 'succeeded', dedupeKey: null }),
    ]);
  });

  it('completes without a request when the project was deleted', async () => {
    const fetchFn = vi.fn();

    await expect(createSnapshotCaptureHandler(db, SNAPSHOTTER_URL, {
      fetch: fetchFn,
    })(job(randomUUID()))).resolves.toBeUndefined();

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'a non-object payload', payload: 'not-an-object' },
    { name: 'a null payload', payload: null },
    { name: 'an array payload', payload: [] },
    { name: 'a missing projectId', payload: { url: SNAPSHOT_URL } },
    { name: 'a missing url', payload: { projectId: 'project' } },
    {
      name: 'an empty projectId',
      payload: { projectId: '', url: SNAPSHOT_URL },
    },
    {
      name: 'an empty url',
      payload: { projectId: 'project', url: '' },
    },
    {
      name: 'a non-string projectId',
      payload: { projectId: 123, url: SNAPSHOT_URL },
    },
    {
      name: 'a non-string url',
      payload: {
        projectId: 'project',
        url: { value: 'payload-secret.example/private' },
      },
      secret: 'payload-secret.example/private',
    },
    {
      name: 'a null deploymentId',
      payload: { projectId: 'project', url: SNAPSHOT_URL, deploymentId: null },
    },
    {
      name: 'an empty deploymentId',
      payload: { projectId: 'project', url: SNAPSHOT_URL, deploymentId: '' },
    },
    {
      name: 'a non-string deploymentId',
      payload: { projectId: 'project', url: SNAPSHOT_URL, deploymentId: 123 },
    },
    {
      name: 'a null requestId',
      payload: { projectId: 'project', url: SNAPSHOT_URL, requestId: null },
    },
    {
      name: 'an empty requestId',
      payload: { projectId: 'project', url: SNAPSHOT_URL, requestId: '' },
    },
    {
      name: 'a non-string requestId',
      payload: { projectId: 'project', url: SNAPSHOT_URL, requestId: 123 },
    },
    {
      name: 'an unknown key',
      payload: {
        projectId: 'project',
        url: SNAPSHOT_URL,
        'payload-secret.example/private': true,
      },
      secret: 'payload-secret.example/private',
    },
  ])('rejects $name safely', async ({ payload, secret }) => {
    const malformedJob: JobRecord = {
      ...job(randomUUID()),
      payload: payload as JobRecord['payload'],
    };
    const fetchFn = vi.fn();

    const error = await createSnapshotCaptureHandler(db, SNAPSHOTTER_URL, {
      fetch: fetchFn,
    })(malformedJob).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('invalid snapshot capture payload');
    if (secret) expect((error as Error).message).not.toContain(secret);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('discards an automatic result when a manual upload wins during capture', async () => {
    const projectId = await insertProject();
    const response = deferred<Response>();
    const fetchFn = vi.fn(() => response.promise);
    await enqueueSnapshotCapture(db, { projectId, url: SNAPSHOT_URL });
    const runner = createRunner(db, {
      'snapshot.capture': createSnapshotCaptureHandler(db, SNAPSHOTTER_URL, {
        fetch: fetchFn,
      }),
    }, 'snapshot-manual-race-worker');
    const running = runner.runOnce();
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());

    const manualImage = Buffer.from('manual-image');
    await saveManualSnapshot(db, {
      projectId,
      imageData: manualImage,
      width: 1440,
      height: 900,
      checksum: 'manual-checksum',
    });
    response.resolve(successResponse());

    await expect(running).resolves.toEqual({
      claimed: 1,
      succeeded: 1,
      failed: 0,
    });
    expect(await getSnapshotState(db, projectId)).toMatchObject({
      imageData: manualImage,
      source: 'manual',
      checksum: 'manual-checksum',
    });
    expect(await db.select().from(schema.jobs)).toEqual([
      expect.objectContaining({
        status: 'succeeded',
        dedupeKey: null,
      }),
    ]);
  });

  it('atomically trails the latest URL when its enqueue loses to the running job', async () => {
    const projectId = await insertProject();
    const response = deferred<Response>();
    const fetchFn = vi.fn()
      .mockImplementationOnce(() => response.promise)
      .mockResolvedValueOnce(successResponse());
    await enqueueSnapshotCapture(db, {
      projectId,
      url: SNAPSHOT_URL,
      requestId: 'old-request',
    });
    const runner = createRunner(db, {
      'snapshot.capture': createSnapshotCaptureHandler(db, SNAPSHOTTER_URL, {
        fetch: fetchFn,
      }),
    }, 'snapshot-race-worker');
    const running = runner.runOnce();
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());

    const latestUrl = 'https://new.example/app';
    await db
      .update(schema.projects)
      .set({ snapshotUrl: latestUrl })
      .where(eq(schema.projects.id, projectId));
    await expect(enqueueSnapshotCapture(db, {
      projectId,
      url: latestUrl,
      requestId: 'enqueue-that-loses-the-race',
    })).resolves.toBe(true);
    response.resolve(successResponse());

    await expect(running).resolves.toEqual({
      claimed: 1,
      succeeded: 1,
      failed: 0,
    });
    expect(await getSnapshotState(db, projectId)).toMatchObject({
      imageData: null,
      lastAttemptAt: null,
      lastAttemptStatus: null,
      lastError: null,
    });
    const afterStale = await db.select().from(schema.jobs);
    expect(afterStale).toHaveLength(2);
    expect(afterStale).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'succeeded',
        dedupeKey: null,
        payload: expect.objectContaining({ url: SNAPSHOT_URL }),
      }),
      expect.objectContaining({
        status: 'pending',
        dedupeKey: `snapshot:${projectId}`,
        payload: expect.objectContaining({
          projectId,
          url: latestUrl,
        }),
      }),
    ]));

    await expect(runner.runOnce()).resolves.toEqual({
      claimed: 1,
      succeeded: 1,
      failed: 0,
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(await getSnapshotState(db, projectId)).toMatchObject({
      imageData: IMAGE,
      source: 'automatic',
      sourceUrl: latestUrl,
      lastAttemptStatus: 'success',
      lastError: null,
    });
  });

  it('does not clear a newer pending attempt while reconciling a stale result', async () => {
    const projectId = await insertProject();
    const response = deferred<Response>();
    const fetchFn = vi.fn(() => response.promise);
    await enqueueSnapshotCapture(db, { projectId, url: SNAPSHOT_URL });
    const runner = createRunner(db, {
      'snapshot.capture': createSnapshotCaptureHandler(db, SNAPSHOTTER_URL, {
        fetch: fetchFn,
      }),
    }, 'snapshot-newer-attempt-worker');
    const running = runner.runOnce();
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());

    const latestUrl = 'https://newer-attempt.example/app';
    await db
      .update(schema.projects)
      .set({ snapshotUrl: latestUrl })
      .where(eq(schema.projects.id, projectId));
    await expect(markSnapshotPending(db, projectId, latestUrl)).resolves.toBe(true);
    const newerAttempt = await getSnapshotState(db, projectId);
    response.resolve(successResponse());

    await expect(running).resolves.toEqual({
      claimed: 1,
      succeeded: 1,
      failed: 0,
    });
    expect(await getSnapshotState(db, projectId)).toMatchObject({
      lastAttemptAt: newerAttempt!.lastAttemptAt,
      lastAttemptStatus: 'pending',
      lastError: null,
    });
    expect(await db.select().from(schema.jobs)).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'succeeded', dedupeKey: null }),
      expect.objectContaining({
        status: 'pending',
        dedupeKey: `snapshot:${projectId}`,
        payload: expect.objectContaining({ url: latestUrl }),
      }),
    ]));
  });

  it('completes when the project is deleted during capture', async () => {
    const projectId = await insertProject();
    const response = deferred<Response>();
    const fetchFn = vi.fn(() => response.promise);
    const running = createSnapshotCaptureHandler(db, SNAPSHOTTER_URL, {
      fetch: fetchFn,
    })(job(projectId));
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());

    await db.delete(schema.projects).where(eq(schema.projects.id, projectId));
    response.resolve(successResponse());

    await expect(running).resolves.toBeUndefined();
  });

  it.each([
    ['network failure', () => Promise.reject(new Error('network secret')), 'navigation_failed'],
    ['timeout response', () => Promise.resolve(errorResponse('timeout', 504)), 'timeout'],
    ['navigation response', () => Promise.resolve(errorResponse('navigation_failed', 502)), 'navigation_failed'],
    ['render response', () => Promise.resolve(errorResponse('render_failed', 500)), 'render_failed'],
    ['service unavailable', () => Promise.resolve(errorResponse('navigation_failed', 503)), 'navigation_failed'],
    ['unknown response', () => Promise.resolve(errorResponse('secret_code', 500)), 'render_failed'],
  ])('records and retries %s safely', async (_name, fetchImpl, code) => {
    const projectId = await insertProject();

    await expect(createSnapshotCaptureHandler(db, SNAPSHOTTER_URL, {
      fetch: vi.fn(fetchImpl),
    })(job(projectId))).rejects.toThrow(`snapshot capture failed: ${code}`);

    expect(await getSnapshotState(db, projectId)).toMatchObject({
      lastAttemptStatus: 'failed',
      lastError: code,
    });
  });

  it('lets a trailing job replace a superseded transient retry', async () => {
    const projectId = await insertProject();
    const response = deferred<Response>();
    const fetchFn = vi.fn()
      .mockImplementationOnce(() => response.promise)
      .mockResolvedValueOnce(successResponse());
    await enqueueSnapshotCapture(db, { projectId, url: SNAPSHOT_URL });
    const runner = createRunner(db, {
      'snapshot.capture': createSnapshotCaptureHandler(db, SNAPSHOTTER_URL, {
        fetch: fetchFn,
      }),
    }, 'snapshot-transient-trailing-worker');
    const firstRun = runner.runOnce();
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());

    await expect(enqueueSnapshotCapture(db, {
      projectId,
      url: SNAPSHOT_URL,
      requestId: 'newer-request',
    })).resolves.toBe(true);
    response.resolve(errorResponse('navigation_failed', 502));

    await expect(firstRun).resolves.toEqual({
      claimed: 1,
      succeeded: 0,
      failed: 1,
    });
    expect(await db.select().from(schema.jobs)).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'failed', dedupeKey: null }),
      expect.objectContaining({
        status: 'pending',
        dedupeKey: `snapshot:${projectId}`,
        payload: expect.objectContaining({ requestId: 'newer-request' }),
      }),
    ]));

    await expect(runner.runOnce()).resolves.toEqual({
      claimed: 1,
      succeeded: 1,
      failed: 0,
    });
    expect(await getSnapshotState(db, projectId)).toMatchObject({
      source: 'automatic',
      sourceUrl: SNAPSHOT_URL,
      lastAttemptStatus: 'success',
    });
  });

  it('aborts after the hard deadline, records timeout, and retries', async () => {
    vi.useFakeTimers();
    try {
      const projectId = await insertProject();
      const fetchFn = vi.fn((_url: unknown, init?: RequestInit) => (
        new Promise<Response>((_resolve, reject) => {
          if (!init?.signal) throw new Error('missing abort signal');
          init.signal.addEventListener('abort', () => {
            reject(new DOMException('target secret', 'AbortError'));
          });
        })
      ));
      const running = createSnapshotCaptureHandler(db, SNAPSHOTTER_URL, {
        fetch: fetchFn,
      })(job(projectId));
      await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());

      await vi.advanceTimersByTimeAsync(20_000);

      await expect(running).rejects.toThrow('snapshot capture failed: timeout');
      expect(fetchFn.mock.calls[0]![1]?.signal?.aborted).toBe(true);
      expect(await getSnapshotState(db, projectId)).toMatchObject({
        lastAttemptStatus: 'failed',
        lastError: 'timeout',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps a fetch AbortError to timeout without retaining its message', async () => {
    const projectId = await insertProject();

    const error = await createSnapshotCaptureHandler(db, SNAPSHOTTER_URL, {
      fetch: vi.fn().mockRejectedValue(
        new DOMException('abort secret target', 'AbortError'),
      ),
    })(job(projectId)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('snapshot capture failed: timeout');
    expect((error as Error).message).not.toContain('abort secret target');
    expect(await getSnapshotState(db, projectId)).toMatchObject({
      lastAttemptStatus: 'failed',
      lastError: 'timeout',
    });
  });

  it.each([
    ['blocked_target', 400],
    ['image_too_large', 413],
  ])('records %s and completes a permanent failure', async (code, status) => {
    const projectId = await insertProject();

    await expect(createSnapshotCaptureHandler(db, SNAPSHOTTER_URL, {
      fetch: vi.fn().mockResolvedValue(errorResponse(code, status)),
    })(job(projectId))).resolves.toBeUndefined();

    expect(await getSnapshotState(db, projectId)).toMatchObject({
      lastAttemptStatus: 'failed',
      lastError: code,
    });
  });

  it('does not retry when mode changes before a transient failure is recorded', async () => {
    const projectId = await insertProject();
    const response = deferred<Response>();
    const fetchFn = vi.fn(() => response.promise);
    const running = createSnapshotCaptureHandler(db, SNAPSHOTTER_URL, {
      fetch: fetchFn,
    })(job(projectId));
    await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());

    await db
      .update(schema.projects)
      .set({ snapshotMode: 'manual' })
      .where(eq(schema.projects.id, projectId));
    response.resolve(errorResponse('render_failed'));

    await expect(running).resolves.toBeUndefined();
    expect(await getSnapshotState(db, projectId)).toMatchObject({
      lastAttemptStatus: 'pending',
      lastError: null,
    });
  });

  it('preserves an existing image when capture fails', async () => {
    const projectId = await insertProject();
    const existingImage = Buffer.from('existing-webp');
    await saveAutomaticSnapshot(db, {
      projectId,
      url: SNAPSHOT_URL,
      imageData: existingImage,
      width: 1440,
      height: 900,
      checksum: 'existing-checksum',
    });

    await expect(createSnapshotCaptureHandler(db, SNAPSHOTTER_URL, {
      fetch: vi.fn().mockRejectedValue(new Error('network failure')),
    })(job(projectId))).rejects.toThrow('snapshot capture failed: navigation_failed');

    expect(await getSnapshotState(db, projectId)).toMatchObject({
      imageData: existingImage,
      checksum: 'existing-checksum',
      lastAttemptStatus: 'failed',
      lastError: 'navigation_failed',
    });
  });

  it.each([
    ['non-200 malformed error', new Response('secret response', { status: 500 }), 'render_failed'],
    ['wrong content type', successResponse(IMAGE, { 'content-type': 'image/png' }), 'render_failed'],
    ['wrong width', successResponse(IMAGE, { 'x-image-width': '1439' }), 'render_failed'],
    ['wrong height', successResponse(IMAGE, { 'x-image-height': '899' }), 'render_failed'],
    ['oversized content length', successResponse(IMAGE, { 'content-length': String(MAX_IMAGE_BYTES + 1) }), 'image_too_large'],
  ])('validates %s', async (_name, response, code) => {
    const projectId = await insertProject();
    const expectation = expect(createSnapshotCaptureHandler(db, SNAPSHOTTER_URL, {
      fetch: vi.fn().mockResolvedValue(response),
    })(job(projectId)));

    if (code === 'image_too_large') await expectation.resolves.toBeUndefined();
    else await expectation.rejects.toThrow(`snapshot capture failed: ${code}`);
    expect(await getSnapshotState(db, projectId)).toMatchObject({
      lastAttemptStatus: 'failed',
      lastError: code,
    });
  });

  it('rejects a streamed body that exceeds the cap even when its header lies', async () => {
    const projectId = await insertProject();
    const first = new Uint8Array(MAX_IMAGE_BYTES);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(first);
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    const response = successResponse(stream, { 'content-length': '1' });

    await expect(createSnapshotCaptureHandler(db, SNAPSHOTTER_URL, {
      fetch: vi.fn().mockResolvedValue(response),
    })(job(projectId))).resolves.toBeUndefined();

    expect(await getSnapshotState(db, projectId)).toMatchObject({
      lastAttemptStatus: 'failed',
      lastError: 'image_too_large',
    });
  });

  it.each([
    {
      name: 'oversized declared image',
      status: 200,
      headers: {
        'content-type': 'image/webp',
        'content-length': String(MAX_IMAGE_BYTES + 1),
        'x-image-width': '1440',
        'x-image-height': '900',
      },
      permanent: true,
    },
    {
      name: 'non-JSON error',
      status: 500,
      headers: { 'content-type': 'text/plain' },
      permanent: false,
    },
    {
      name: 'invalid image MIME type',
      status: 200,
      headers: {
        'content-type': 'image/png',
        'x-image-width': '1440',
        'x-image-height': '900',
      },
      permanent: false,
    },
    {
      name: 'invalid image dimensions',
      status: 200,
      headers: {
        'content-type': 'image/webp',
        'x-image-width': '1',
        'x-image-height': '900',
      },
      permanent: false,
    },
  ])('cancels the response body for $name', async ({
    status,
    headers,
    permanent,
  }) => {
    const projectId = await insertProject();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel,
    });
    const response = new Response(stream, { status, headers });
    const handled = createSnapshotCaptureHandler(db, SNAPSHOTTER_URL, {
      fetch: vi.fn().mockResolvedValue(response),
    })(job(projectId));

    if (permanent) await expect(handled).resolves.toBeUndefined();
    else await expect(handled).rejects.toThrow('snapshot capture failed');
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });

  it('releases a response reader after malformed JSON or a stream read error', async () => {
    const malformedProjectId = await insertProject();
    const malformed = new Response('{not-json', {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
    await expect(createSnapshotCaptureHandler(db, SNAPSHOTTER_URL, {
      fetch: vi.fn().mockResolvedValue(malformed),
    })(job(malformedProjectId))).rejects.toThrow(
      'snapshot capture failed: render_failed',
    );
    expect(malformed.body?.locked).toBe(false);

    const failedProjectId = await insertProject();
    const failedStream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error('stream secret'));
      },
    });
    const failed = successResponse(failedStream, { 'content-length': '1' });
    await expect(createSnapshotCaptureHandler(db, SNAPSHOTTER_URL, {
      fetch: vi.fn().mockResolvedValue(failed),
    })(job(failedProjectId))).rejects.toThrow(
      'snapshot capture failed: render_failed',
    );
    expect(failed.body?.locked).toBe(false);
  });

  it.each([
    undefined,
    '',
    'ftp://snapshotter.internal/private',
    'http://user:password@snapshotter.internal/private',
    'not-a-url-with-secret',
  ])('records a safe retryable failure for invalid snapshotter config', async (snapshotterUrl) => {
    const projectId = await insertProject();
    const fetchFn = vi.fn();

    const error = await createSnapshotCaptureHandler(db, snapshotterUrl, {
      fetch: fetchFn,
    })(job(projectId)).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      'snapshot capture failed: navigation_failed',
    );
    if (snapshotterUrl) {
      expect((error as Error).message).not.toContain(snapshotterUrl);
    }
    expect(fetchFn).not.toHaveBeenCalled();
    expect(await getSnapshotState(db, projectId)).toMatchObject({
      lastAttemptStatus: 'failed',
      lastError: 'navigation_failed',
    });
  });
});
