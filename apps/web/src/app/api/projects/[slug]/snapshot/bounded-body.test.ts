import { describe, expect, it, vi } from 'vitest';
import { readBoundedBody, type BodyReadTimer } from './bounded-body';

function never(): Promise<never> {
  return new Promise(() => undefined);
}

async function promptly<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error('did not settle promptly')), 100);
    }),
  ]);
}

function fakeBody(reader: Record<string, unknown>): ReadableStream<Uint8Array> {
  return { getReader: () => reader } as unknown as ReadableStream<Uint8Array>;
}

describe('readBoundedBody', () => {
  it('stores arbitrarily many small chunks in one fixed allocation', async () => {
    const chunkCount = 10_000;
    let emitted = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted === chunkCount) {
          controller.close();
          return;
        }
        controller.enqueue(Uint8Array.of(emitted % 251));
        emitted += 1;
      },
    });
    const allocate = vi.fn((size: number) => new Uint8Array(size));

    const result = await readBoundedBody(stream, {
      maximumBytes: chunkCount,
      timeoutMs: 10_000,
      allocate,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected bounded body');
    expect(allocate).toHaveBeenCalledOnce();
    expect(allocate).toHaveBeenCalledWith(chunkCount);
    expect(result.body.byteLength).toBe(chunkCount);
    expect(result.body.buffer.byteLength).toBe(chunkCount);
    expect(result.body[9_999]).toBe(9_999 % 251);
  });

  it('cancels and unlocks the reader when the total byte limit is exceeded', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(4));
        controller.enqueue(new Uint8Array(1));
      },
      cancel,
    });

    await expect(readBoundedBody(stream, {
      maximumBytes: 4,
      timeoutMs: 10_000,
    })).resolves.toEqual({ ok: false, reason: 'too_large' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });

  it('cancels without reading when declared length exceeds the limit', async () => {
    const cancel = vi.fn();
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        pulls += 1;
      },
      cancel,
    });

    await expect(readBoundedBody(stream, {
      maximumBytes: 4,
      timeoutMs: 10_000,
      declaredLength: '5',
    })).resolves.toEqual({ ok: false, reason: 'too_large' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(pulls).toBe(0);
    expect(stream.locked).toBe(false);
  });

  it('uses the injected deadline timer and cancels a stalled read', async () => {
    const cancel = vi.fn(() => never());
    const releaseLock = vi.fn(() => {
      throw new TypeError('pending read');
    });
    const reader = { read: vi.fn(() => never()), cancel, releaseLock };
    const stream = fakeBody(reader);
    const controller = new AbortController();
    const addEventListener = vi.spyOn(controller.signal, 'addEventListener');
    const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
    const timer: BodyReadTimer = {
      setTimeout(callback) {
        queueMicrotask(callback);
        return 1;
      },
      clearTimeout: vi.fn(),
    };

    await expect(promptly(readBoundedBody(stream, {
      maximumBytes: 16,
      timeoutMs: 10_000,
      timer,
      signal: controller.signal,
    }))).resolves.toEqual({ ok: false, reason: 'timeout' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
    expect(timer.clearTimeout).toHaveBeenCalledWith(1);
    expect(addEventListener).toHaveBeenCalledOnce();
    expect(removeEventListener).toHaveBeenCalledOnce();
  });

  it('cancels and unlocks the reader when the request signal aborts', async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const controller = new AbortController();
    const pending = readBoundedBody(stream, {
      maximumBytes: 16,
      timeoutMs: 10_000,
      signal: controller.signal,
    });

    controller.abort();

    await expect(pending).resolves.toEqual({ ok: false, reason: 'aborted' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
  });

  it('returns promptly on abort even when cancel and read never settle', async () => {
    const cancel = vi.fn(() => never());
    const releaseLock = vi.fn(() => {
      throw new TypeError('pending read');
    });
    const stream = fakeBody({ read: vi.fn(() => never()), cancel, releaseLock });
    const controller = new AbortController();
    const pending = readBoundedBody(stream, {
      maximumBytes: 16,
      timeoutMs: 10_000,
      signal: controller.signal,
    });

    controller.abort();

    await expect(promptly(pending)).resolves.toEqual({
      ok: false,
      reason: 'aborted',
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
  });

  it('returns declared overflow promptly when cancel never settles', async () => {
    const cancel = vi.fn(() => never());
    const releaseLock = vi.fn();
    const read = vi.fn(() => never());
    const stream = fakeBody({ read, cancel, releaseLock });

    await expect(promptly(readBoundedBody(stream, {
      maximumBytes: 4,
      timeoutMs: 10_000,
      declaredLength: '5',
    }))).resolves.toEqual({ ok: false, reason: 'too_large' });
    expect(read).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
  });

  it('returns actual overflow promptly when cancel never settles', async () => {
    const cancel = vi.fn(() => never());
    const releaseLock = vi.fn();
    const stream = fakeBody({
      read: vi.fn().mockResolvedValue({
        done: false,
        value: new Uint8Array(5),
      }),
      cancel,
      releaseLock,
    });

    await expect(promptly(readBoundedBody(stream, {
      maximumBytes: 4,
      timeoutMs: 10_000,
    }))).resolves.toEqual({ ok: false, reason: 'too_large' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
  });

  it('returns stream errors promptly and observes a never-settling cancel', async () => {
    const cancel = vi.fn(() => never());
    const releaseLock = vi.fn();
    const stream = fakeBody({
      read: vi.fn().mockRejectedValue(new Error('stream failed')),
      cancel,
      releaseLock,
    });

    await expect(promptly(readBoundedBody(stream, {
      maximumBytes: 4,
      timeoutMs: 10_000,
    }))).resolves.toEqual({ ok: false, reason: 'stream_error' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
  });
});
