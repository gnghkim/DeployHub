import { describe, expect, it, vi } from 'vitest';
import { readBoundedBody, type BodyReadTimer } from './bounded-body';

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
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const timer: BodyReadTimer = {
      setTimeout(callback) {
        queueMicrotask(callback);
        return 1;
      },
      clearTimeout: vi.fn(),
    };

    await expect(readBoundedBody(stream, {
      maximumBytes: 16,
      timeoutMs: 10_000,
      timer,
    })).resolves.toEqual({ ok: false, reason: 'timeout' });
    expect(cancel).toHaveBeenCalledOnce();
    expect(stream.locked).toBe(false);
    expect(timer.clearTimeout).toHaveBeenCalledWith(1);
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
});
