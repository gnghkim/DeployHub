export type BodyReadFailureReason =
  | 'too_large'
  | 'timeout'
  | 'aborted'
  | 'stream_error';

export type BoundedBodyResult =
  | { ok: true; body: Uint8Array<ArrayBuffer> }
  | { ok: false; reason: BodyReadFailureReason };

export type BodyReadTimer = {
  setTimeout: (callback: () => void, delayMs: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

type ReadBoundedBodyOptions = {
  maximumBytes: number;
  timeoutMs: number;
  declaredLength?: string | null;
  signal?: AbortSignal;
  timer?: BodyReadTimer;
  allocate?: (size: number) => Uint8Array<ArrayBuffer>;
};

class BodyReadInterrupted extends Error {
  constructor(readonly reason: 'timeout' | 'aborted') {
    super(reason);
  }
}

const systemTimer: BodyReadTimer = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(
    handle as ReturnType<typeof globalThis.setTimeout>,
  ),
};

function declaredLengthExceeds(value: string | null | undefined, maximum: number) {
  if (value === null || value === undefined || !/^\d+$/.test(value)) {
    return false;
  }
  const length = Number(value);
  return !Number.isSafeInteger(length) || length > maximum;
}

function startCancel(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): void {
  try {
    void reader.cancel().catch(() => undefined);
  } catch {
    // A synchronous cancellation error is observed and intentionally ignored.
  }
}

function releaseReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reading: Promise<unknown> | undefined,
): void {
  try {
    reader.releaseLock();
    return;
  } catch {
    if (!reading) return;
  }
  void reading
    .catch(() => undefined)
    .finally(() => {
      try {
        reader.releaseLock();
      } catch {
        // No response path waits for a reader that cannot be released.
      }
    });
}

export async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  options: ReadBoundedBodyOptions,
): Promise<BoundedBodyResult> {
  if (!Number.isSafeInteger(options.maximumBytes) || options.maximumBytes < 0) {
    throw new RangeError('maximumBytes must be a non-negative safe integer');
  }
  if (body === null) {
    return { ok: true, body: new Uint8Array(new ArrayBuffer(0)) };
  }

  const reader = body.getReader();
  let timeoutHandle: unknown;
  let timerStarted = false;
  let abortHandler: (() => void) | undefined;
  let reading: Promise<'complete' | 'too_large'> | undefined;
  try {
    if (declaredLengthExceeds(options.declaredLength, options.maximumBytes)) {
      startCancel(reader);
      return { ok: false, reason: 'too_large' };
    }
    if (options.signal?.aborted) {
      startCancel(reader);
      return { ok: false, reason: 'aborted' };
    }

    const allocate = options.allocate
      ?? ((size: number) => new Uint8Array(new ArrayBuffer(size)));
    const storage = allocate(options.maximumBytes);
    if (storage.byteLength !== options.maximumBytes) {
      throw new RangeError('allocate must return the requested byte length');
    }

    let total = 0;
    reading = (async (): Promise<'complete' | 'too_large'> => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return 'complete';
        if (value.byteLength > options.maximumBytes - total) {
          return 'too_large';
        }
        storage.set(value, total);
        total += value.byteLength;
      }
    })();

    let rejectInterrupted: (error: BodyReadInterrupted) => void = () => undefined;
    const interrupted = new Promise<never>((_resolve, reject) => {
      rejectInterrupted = reject;
    });
    const timer = options.timer ?? systemTimer;
    timeoutHandle = timer.setTimeout(
      () => rejectInterrupted(new BodyReadInterrupted('timeout')),
      options.timeoutMs,
    );
    timerStarted = true;
    if (options.signal) {
      abortHandler = () => rejectInterrupted(new BodyReadInterrupted('aborted'));
      options.signal.addEventListener('abort', abortHandler, { once: true });
      if (options.signal.aborted) abortHandler();
    }

    try {
      const result = await Promise.race([reading, interrupted]);
      if (result === 'too_large') {
        startCancel(reader);
        return { ok: false, reason: 'too_large' };
      }
      return { ok: true, body: storage.subarray(0, total) };
    } catch (error) {
      startCancel(reader);
      if (error instanceof BodyReadInterrupted) {
        return { ok: false, reason: error.reason };
      }
      return { ok: false, reason: 'stream_error' };
    }
  } finally {
    if (timerStarted) {
      (options.timer ?? systemTimer).clearTimeout(timeoutHandle);
    }
    if (abortHandler && options.signal) {
      options.signal.removeEventListener('abort', abortHandler);
    }
    releaseReader(reader, reading);
  }
}
