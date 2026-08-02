import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { SnapshotCaptureError } from './errors.js';
import {
  CAPTURE_TIMEOUT_MS,
  MAX_IMAGE_BYTES,
  type BrowserLike,
  type BrowserRequestLike,
  type CaptureDependencies,
  captureSnapshot,
  normalizeScreenshot,
} from './capture.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function request(url: string, redirectedFrom: BrowserRequestLike | null = null): BrowserRequestLike {
  return {
    url: () => url,
    redirectedFrom: () => redirectedFrom,
    method: () => 'GET',
    allHeaders: vi.fn(async () => ({})),
    postDataBuffer: () => null,
  };
}

function browserFixture(options: {
  requests?: BrowserRequestLike[];
  webSockets?: string[];
  popupRequests?: BrowserRequestLike[];
  observedRequests?: BrowserRequestLike[];
  gotoError?: Error;
  screenshotError?: Error;
  screenshot?: Buffer;
} = {}) {
  let routeHandler:
    | ((route: {
        request(): BrowserRequestLike;
        continue(): Promise<void>;
        abort(): Promise<void>;
      }) => Promise<void>)
    | undefined;
  let webSocketHandler: ((route: { url(): string; close(): void }) => Promise<void>) | undefined;
  let contextRouteHandler: typeof routeHandler;
  let contextWebSocketHandler: typeof webSocketHandler;
  let requestListener: ((request: BrowserRequestLike) => void) | undefined;
  let popupListener: ((page: { close(): Promise<void> }) => void) | undefined;

  const continued: string[] = [];
  const aborted: string[] = [];
  const popupClose = vi.fn(async () => undefined);
  const makeRoute = (browserRequest: BrowserRequestLike) => ({
    request: () => browserRequest,
    continue: vi.fn(async () => {
      continued.push(browserRequest.url());
    }),
    fulfill: vi.fn(async () => {
      throw new Error('Proxy mode must preserve native browser responses.');
    }),
    abort: vi.fn(async () => {
      aborted.push(browserRequest.url());
    }),
  });
  const page = {
    route: vi.fn(async (_pattern: string, handler: typeof routeHandler) => {
      routeHandler = handler;
    }),
    routeWebSocket: vi.fn(async (_pattern: string, handler: typeof webSocketHandler) => {
      webSocketHandler = handler;
    }),
    on: vi.fn((event: string, handler: (value: never) => void) => {
      if (event === 'request') requestListener = handler as (request: BrowserRequestLike) => void;
      if (event === 'popup') popupListener = handler as (page: { close(): Promise<void> }) => void;
    }),
    goto: vi.fn(async (
      _url: string,
      _options: { waitUntil: 'domcontentloaded'; timeout: number },
    ) => {
      for (const observedRequest of options.observedRequests ?? options.requests ?? []) {
        requestListener?.(observedRequest);
      }
      for (const browserRequest of options.requests ?? [request('https://example.com/')]) {
        const route = makeRoute(browserRequest);
        await routeHandler?.(route);
        if (aborted.includes(browserRequest.url())) {
          throw new Error('navigation aborted');
        }
      }
      for (const browserRequest of options.popupRequests ?? []) {
        const route = makeRoute(browserRequest);
        await contextRouteHandler?.(route);
        if (aborted.includes(browserRequest.url())) throw new Error('popup aborted');
      }
      for (const url of options.webSockets ?? []) {
        await webSocketHandler?.({ url: () => url, close: vi.fn() });
      }
      popupListener?.({ close: popupClose });
      if (options.gotoError) throw options.gotoError;
    }),
    screenshot: vi.fn(async () => {
      if (options.screenshotError) throw options.screenshotError;
      return options.screenshot ?? Buffer.from('png bytes');
    }),
    close: vi.fn(async () => undefined),
  };
  const context = {
    route: vi.fn(async (_pattern: string, handler: typeof routeHandler) => {
      contextRouteHandler = handler;
    }),
    routeWebSocket: vi.fn(async (_pattern: string, handler: typeof webSocketHandler) => {
      contextWebSocketHandler = handler;
    }),
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined),
  };
  const browser: BrowserLike = {
    newContext: vi.fn(async () => context),
    close: vi.fn(async () => undefined),
  };
  const launchBrowser = vi.fn(async () => browser);
  let proxyFailure: SnapshotCaptureError | undefined;
  const proxy = {
    url: 'http://127.0.0.1:43123',
    activeStreamCount: 0,
    get failure() {
      return proxyFailure;
    },
    block: vi.fn((error: SnapshotCaptureError) => {
      proxyFailure = error;
    }),
    close: vi.fn(async () => undefined),
  };
  const startProxy = vi.fn(async () => proxy);

  return {
    aborted,
    browser,
    context,
    contextWebSocketHandler,
    continued,
    launchBrowser,
    page,
    popupClose,
    proxy,
    startProxy,
  };
}

function dependencies(
  fixture: ReturnType<typeof browserFixture>,
  overrides: Partial<CaptureDependencies> = {},
): CaptureDependencies {
  return {
    launchBrowser: fixture.launchBrowser,
    startProxy: fixture.startProxy,
    normalizeImage: vi.fn(async () => Buffer.from('RIFF0000WEBPnormalized')),
    settle: vi.fn(async () => undefined),
    validateUrl: vi.fn(async (url: string) => url),
    ...overrides,
  };
}

describe('captureSnapshot', () => {
  it('uses a fresh locked-down context and captures only the fixed first viewport', async () => {
    const fixture = browserFixture();
    const deps = dependencies(fixture);

    const image = await captureSnapshot('https://example.com/', deps);

    expect(image).toEqual(Buffer.from('RIFF0000WEBPnormalized'));
    expect(fixture.startProxy).toHaveBeenCalledWith(expect.objectContaining({
      signal: expect.any(AbortSignal),
    }));
    expect(fixture.launchBrowser).toHaveBeenCalledWith({
      headless: true,
      proxy: { server: 'http://127.0.0.1:43123' },
      args: [
        '--disable-quic',
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        '--host-resolver-rules=MAP * ~NOTFOUND',
        '--proxy-bypass-list=<-loopback>',
      ],
    });
    expect(fixture.browser.newContext).toHaveBeenCalledWith({
      acceptDownloads: false,
      ignoreHTTPSErrors: false,
      serviceWorkers: 'block',
      viewport: { width: 1440, height: 900 },
    });
    expect(fixture.page.route).toHaveBeenCalledWith('**/*', expect.any(Function));
    expect(fixture.context.route).toHaveBeenCalledWith('**/*', expect.any(Function));
    expect(fixture.page.routeWebSocket).toHaveBeenCalledWith('**/*', expect.any(Function));
    expect(fixture.page.goto).toHaveBeenCalledWith('https://example.com/', {
      timeout: expect.any(Number),
      waitUntil: 'domcontentloaded',
    });
    const gotoOptions = fixture.page.goto.mock.calls[0]?.[1] as { timeout: number };
    expect(gotoOptions.timeout).toBeGreaterThan(0);
    expect(gotoOptions.timeout).toBeLessThanOrEqual(CAPTURE_TIMEOUT_MS);
    expect(deps.settle).toHaveBeenCalledWith(250, expect.any(AbortSignal));
    expect(fixture.page.screenshot).toHaveBeenCalledWith({
      fullPage: false,
      type: 'png',
    });
    expect(deps.normalizeImage).toHaveBeenCalledWith(Buffer.from('png bytes'));
  });

  it('validates routed initial and asset requests before continuing', async () => {
    const initial = request('https://example.com/');
    const asset = request('https://static.example.com/app.js');
    const fixture = browserFixture({ requests: [initial, asset] });
    const validateUrl = vi.fn(async (url: string) => url);

    await captureSnapshot('https://example.com/', dependencies(fixture, { validateUrl }));

    expect(validateUrl.mock.calls).toEqual([
      ['https://example.com/', 0],
      ['https://example.com/', 0],
      ['https://static.example.com/app.js', 0],
    ]);
    expect(fixture.continued).toEqual([
      'https://example.com/',
      'https://static.example.com/app.js',
    ]);
  });

  it('aborts a routed request and surfaces blocked_target when policy rejects it', async () => {
    const fixture = browserFixture({
      requests: [request('https://example.com/'), request('http://127.0.0.1/private')],
    });
    const validateUrl = vi.fn(async (url: string) => {
      if (url.includes('127.0.0.1')) throw new SnapshotCaptureError('blocked_target');
      return url;
    });

    await expect(
      captureSnapshot('https://example.com/', dependencies(fixture, { validateUrl })),
    ).rejects.toMatchObject({ code: 'blocked_target' });
    expect(fixture.aborted).toEqual(['http://127.0.0.1/private']);
    expect(fixture.page.screenshot).not.toHaveBeenCalled();
  });

  it('blocks WebSocket connections that cannot pass the HTTP target policy', async () => {
    const fixture = browserFixture({ webSockets: ['ws://127.0.0.1/private'] });
    const validateUrl = vi.fn(async (url: string) => {
      if (url.startsWith('ws:')) throw new SnapshotCaptureError('blocked_target');
      return url;
    });

    await expect(
      captureSnapshot('https://example.com/', dependencies(fixture, { validateUrl })),
    ).rejects.toEqual(new SnapshotCaptureError('blocked_target'));
  });

  it('uses context routing to block a popup initial request', async () => {
    const fixture = browserFixture({
      popupRequests: [request('http://127.0.0.1/private')],
    });
    const validateUrl = vi.fn(async (url: string) => {
      if (url.includes('127.0.0.1')) throw new SnapshotCaptureError('blocked_target');
      return url;
    });

    await expect(
      captureSnapshot('https://example.com/', dependencies(fixture, { validateUrl })),
    ).rejects.toEqual(new SnapshotCaptureError('blocked_target'));
    expect(fixture.aborted).toEqual(['http://127.0.0.1/private']);
  });

  it('closes popup pages that pass the public proxy policy', async () => {
    const fixture = browserFixture();

    await captureSnapshot('https://example.com/', dependencies(fixture));

    expect(fixture.popupClose).toHaveBeenCalledOnce();
  });

  it('allows five native redirects and blocks the sixth before it completes', async () => {
    const requests: BrowserRequestLike[] = [request('https://example.com/0')];
    for (let index = 1; index <= 6; index += 1) {
      requests.push(request(`https://example.com/${index}`, requests[index - 1] ?? null));
    }
    const fixture = browserFixture({
      requests: [requests[0]!],
      observedRequests: requests.slice(1),
    });

    await expect(
      captureSnapshot('https://example.com/0', dependencies(fixture)),
    ).rejects.toEqual(new SnapshotCaptureError('blocked_target'));
    expect(fixture.proxy.block).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'blocked_target' }),
    );
    expect(fixture.proxy.block).toHaveBeenCalledOnce();
    expect(fixture.page.close).toHaveBeenCalled();
  });

  it('does not block a chain of exactly five native redirects', async () => {
    const requests: BrowserRequestLike[] = [request('https://example.com/0')];
    for (let index = 1; index <= 5; index += 1) {
      requests.push(request(`https://example.com/${index}`, requests[index - 1] ?? null));
    }
    const fixture = browserFixture({
      requests: [requests[0]!],
      observedRequests: requests.slice(1),
    });

    await captureSnapshot('https://example.com/0', dependencies(fixture));

    expect(fixture.proxy.block).not.toHaveBeenCalled();
  });

  it('maps navigation failures to navigation_failed', async () => {
    const fixture = browserFixture({ gotoError: new Error('upstream navigation details') });

    await expect(
      captureSnapshot('https://example.com/private?q=secret', dependencies(fixture)),
    ).rejects.toEqual(new SnapshotCaptureError('navigation_failed'));
  });

  it.each([
    ['screenshot', { screenshotError: new Error('page details') }],
    ['normalization', {}],
  ])('maps %s failures to render_failed', async (stage, fixtureOptions) => {
    const fixture = browserFixture(fixtureOptions);
    const normalizeImage =
      stage === 'normalization'
        ? vi.fn(async () => {
            throw new Error('codec details');
          })
        : vi.fn(async () => Buffer.from('RIFF0000WEBPnormalized'));

    await expect(
      captureSnapshot(
        'https://example.com/',
        dependencies(fixture, { normalizeImage }),
      ),
    ).rejects.toEqual(new SnapshotCaptureError('render_failed'));
  });

  it('maps an overall abort to timeout and still cleans up', async () => {
    const fixture = browserFixture();
    fixture.page.goto.mockImplementation(async () => new Promise<never>(() => undefined));
    const controller = new AbortController();
    const pending = captureSnapshot(
      'https://example.com/',
      dependencies(fixture, { signal: controller.signal }),
    );

    await vi.waitFor(() => expect(fixture.page.goto).toHaveBeenCalledOnce());
    controller.abort();

    await expect(pending).rejects.toEqual(new SnapshotCaptureError('timeout'));
    expect(fixture.page.close).toHaveBeenCalledOnce();
    expect(fixture.context.close).toHaveBeenCalledOnce();
    expect(fixture.browser.close).toHaveBeenCalledOnce();
    expect(fixture.proxy.close).toHaveBeenCalledOnce();
  });

  it('does not let hanging cleanup extend an expired deadline', async () => {
    const fixture = browserFixture();
    fixture.page.goto.mockImplementation(async () => new Promise<never>(() => undefined));
    fixture.page.close.mockImplementation(async () => new Promise<never>(() => undefined));
    const controller = new AbortController();
    const pending = captureSnapshot(
      'https://example.com/',
      dependencies(fixture, { signal: controller.signal }),
    );
    await vi.waitFor(() => expect(fixture.page.goto).toHaveBeenCalledOnce());

    controller.abort();

    const result = await Promise.race([
      pending.then(
        () => 'resolved',
        (error: SnapshotCaptureError) => error.code,
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 50)),
    ]);
    expect(result).toBe('timeout');
    expect(fixture.page.close).toHaveBeenCalledOnce();
  });

  it('keeps the overall deadline active while successful capture resources close', async () => {
    const fixture = browserFixture();
    fixture.page.close.mockImplementation(async () => new Promise<never>(() => undefined));
    const controller = new AbortController();
    const pending = captureSnapshot(
      'https://example.com/',
      dependencies(fixture, { signal: controller.signal }),
    );
    await vi.waitFor(() => expect(fixture.page.close).toHaveBeenCalledOnce());

    controller.abort();

    const result = await Promise.race([
      pending.then(
        () => 'resolved',
        (error: SnapshotCaptureError) => error.code,
      ),
      new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 50)),
    ]);
    expect(result).toBe('timeout');
  });

  it('closes a proxy that starts after capture is aborted', async () => {
    const fixture = browserFixture();
    const pendingProxy = deferred<typeof fixture.proxy>();
    let listening = true;
    fixture.proxy.close.mockImplementation(async () => {
      listening = false;
    });
    const startProxy = vi.fn(() => pendingProxy.promise);
    const controller = new AbortController();
    const capture = captureSnapshot(
      'https://example.com/',
      dependencies(fixture, {
        signal: controller.signal,
        startProxy,
      }),
    );
    await vi.waitFor(() => expect(startProxy).toHaveBeenCalledOnce());

    controller.abort();
    await expect(capture).rejects.toEqual(new SnapshotCaptureError('timeout'));
    pendingProxy.resolve(fixture.proxy);

    await vi.waitFor(() => expect(fixture.proxy.close).toHaveBeenCalledOnce());
    expect(listening).toBe(false);
  });

  it('closes a browser that launches after capture is aborted', async () => {
    const fixture = browserFixture();
    const pendingBrowser = deferred<typeof fixture.browser>();
    fixture.launchBrowser.mockImplementation(() => pendingBrowser.promise);
    const controller = new AbortController();
    const capture = captureSnapshot(
      'https://example.com/',
      dependencies(fixture, { signal: controller.signal }),
    );
    await vi.waitFor(() => expect(fixture.launchBrowser).toHaveBeenCalledOnce());

    controller.abort();
    await expect(capture).rejects.toEqual(new SnapshotCaptureError('timeout'));
    pendingBrowser.resolve(fixture.browser);

    await vi.waitFor(() => expect(fixture.browser.close).toHaveBeenCalledOnce());
  });

  it('closes a context created after capture is aborted', async () => {
    const fixture = browserFixture();
    const pendingContext = deferred<typeof fixture.context>();
    fixture.browser.newContext = vi.fn(() => pendingContext.promise);
    const controller = new AbortController();
    const capture = captureSnapshot(
      'https://example.com/',
      dependencies(fixture, { signal: controller.signal }),
    );
    await vi.waitFor(() => expect(fixture.browser.newContext).toHaveBeenCalledOnce());

    controller.abort();
    await expect(capture).rejects.toEqual(new SnapshotCaptureError('timeout'));
    pendingContext.resolve(fixture.context);

    await vi.waitFor(() => expect(fixture.context.close).toHaveBeenCalledOnce());
  });

  it('closes a page created after capture is aborted', async () => {
    const fixture = browserFixture();
    const pendingPage = deferred<typeof fixture.page>();
    fixture.context.newPage = vi.fn(() => pendingPage.promise);
    const controller = new AbortController();
    const capture = captureSnapshot(
      'https://example.com/',
      dependencies(fixture, { signal: controller.signal }),
    );
    await vi.waitFor(() => expect(fixture.context.newPage).toHaveBeenCalledOnce());

    controller.abort();
    await expect(capture).rejects.toEqual(new SnapshotCaptureError('timeout'));
    pendingPage.resolve(fixture.page);

    await vi.waitFor(() => expect(fixture.page.close).toHaveBeenCalledOnce());
  });

  it('rejects normalized images over 1.5 MB', async () => {
    const fixture = browserFixture();

    await expect(
      captureSnapshot(
        'https://example.com/',
        dependencies(fixture, {
          normalizeImage: vi.fn(async () => Buffer.alloc(MAX_IMAGE_BYTES + 1)),
        }),
      ),
    ).rejects.toEqual(new SnapshotCaptureError('image_too_large'));
  });

  it('rejects a proxy failure recorded while the screenshot is normalized', async () => {
    const fixture = browserFixture();
    const failure = new SnapshotCaptureError('blocked_target');

    await expect(
      captureSnapshot(
        'https://example.com/',
        dependencies(fixture, {
          normalizeImage: vi.fn(async () => {
            fixture.proxy.block(failure);
            return Buffer.from('RIFF0000WEBPnormalized');
          }),
        }),
      ),
    ).rejects.toBe(failure);
  });

  it('closes page, context, and browser after successful capture', async () => {
    const fixture = browserFixture();

    await captureSnapshot('https://example.com/', dependencies(fixture));

    expect(fixture.page.close).toHaveBeenCalledOnce();
    expect(fixture.context.close).toHaveBeenCalledOnce();
    expect(fixture.browser.close).toHaveBeenCalledOnce();
    expect(fixture.proxy.close).toHaveBeenCalledOnce();
  });
});

describe('normalizeScreenshot', () => {
  it('creates an exact 1440x900 metadata-free WebP', async () => {
    const png = await sharp({
      create: {
        width: 40,
        height: 20,
        channels: 4,
        background: { r: 220, g: 10, b: 10, alpha: 1 },
      },
    })
      .png()
      .withMetadata({ exif: { IFD0: { Artist: 'must be removed' } } })
      .toBuffer();

    const output = await normalizeScreenshot(png);
    const metadata = await sharp(output).metadata();

    expect(metadata).toMatchObject({ format: 'webp', width: 1440, height: 900 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
  });
});
