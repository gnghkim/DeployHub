import { chromium } from 'playwright';
import sharp from 'sharp';

import { SnapshotCaptureError } from './errors.js';
import {
  type AddressResolver,
  validatePublicHttpUrl,
} from './url-policy.js';
import {
  type ValidatingProxy,
  startValidatingProxy,
} from './validating-proxy.js';

export const CAPTURE_WIDTH = 1440;
export const CAPTURE_HEIGHT = 900;
export const CAPTURE_TIMEOUT_MS = 20_000;
export const MAX_IMAGE_BYTES = 1_500_000;
const POST_LOAD_SETTLE_MS = 250;

export interface BrowserRequestLike {
  url(): string;
  redirectedFrom(): BrowserRequestLike | null;
  method(): string;
  allHeaders(): Promise<Record<string, string>>;
  postDataBuffer(): Buffer | null;
}

interface RouteLike {
  request(): BrowserRequestLike;
  continue(): Promise<void>;
  abort(errorCode?: 'blockedbyclient'): Promise<void>;
}

interface WebSocketRouteLike {
  url(): string;
  close(): void;
}

interface PageLike {
  route(
    pattern: string,
    handler: (route: RouteLike) => Promise<void>,
  ): Promise<unknown>;
  routeWebSocket(
    pattern: string,
    handler: (route: WebSocketRouteLike) => Promise<void>,
  ): Promise<unknown>;
  on(event: 'request', handler: (request: BrowserRequestLike) => void): void;
  on(event: 'popup', handler: (page: { close(): Promise<void> }) => void): void;
  goto(
    url: string,
    options: { waitUntil: 'domcontentloaded'; timeout: number },
  ): Promise<unknown>;
  screenshot(options: { type: 'png'; fullPage: false }): Promise<Buffer>;
  close(): Promise<void>;
}

interface BrowserContextLike {
  route(
    pattern: string,
    handler: (route: RouteLike) => Promise<void>,
  ): Promise<unknown>;
  routeWebSocket(
    pattern: string,
    handler: (route: WebSocketRouteLike) => Promise<void>,
  ): Promise<unknown>;
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

export interface BrowserLike {
  newContext(options: {
    viewport: { width: number; height: number };
    acceptDownloads: false;
    ignoreHTTPSErrors: false;
    serviceWorkers: 'block';
  }): Promise<BrowserContextLike>;
  close(): Promise<void>;
}

type ValidateUrl = (url: string, redirectCount: number) => Promise<string>;
export interface CaptureDependencies {
  signal?: AbortSignal;
  resolver?: AddressResolver;
  launchBrowser?: (options: {
    headless: true;
    proxy: { server: string };
    args: string[];
  }) => Promise<BrowserLike>;
  startProxy?: typeof startValidatingProxy;
  normalizeImage?: (png: Buffer) => Promise<Buffer>;
  settle?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  validateUrl?: ValidateUrl;
}

export async function normalizeScreenshot(png: Buffer): Promise<Buffer> {
  return sharp(png, { failOn: 'error' })
    .resize(CAPTURE_WIDTH, CAPTURE_HEIGHT, {
      fit: 'contain',
      background: { r: 24, g: 24, b: 27, alpha: 1 },
    })
    .webp({ quality: 82 })
    .toBuffer();
}

async function settle(milliseconds: number, signal: AbortSignal) {
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new SnapshotCaptureError('timeout'));
      return;
    }

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new SnapshotCaptureError('timeout'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new SnapshotCaptureError('timeout');

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new SnapshotCaptureError('timeout'));
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

function redirectDepth(browserRequest: BrowserRequestLike) {
  let depth = 0;
  let previous = browserRequest.redirectedFrom();
  while (previous !== null && depth <= 5) {
    depth += 1;
    previous = previous.redirectedFrom();
  }
  return depth;
}

function isTimeoutError(error: unknown, signal: AbortSignal) {
  return (
    signal.aborted ||
    (error instanceof SnapshotCaptureError && error.code === 'timeout') ||
    (error instanceof Error && error.name === 'TimeoutError')
  );
}

async function closeQuietly(
  resource: { close(): Promise<void> } | undefined,
  signal: AbortSignal,
) {
  if (!resource) return;
  let closing: Promise<void>;
  try {
    closing = resource.close();
  } catch {
    return;
  }
  if (signal.aborted) {
    void closing.catch(() => undefined);
    return;
  }
  try {
    await withAbort(closing, signal);
  } catch {
    // Cleanup failures must not replace or extend the normalized capture result.
  }
}

export async function captureSnapshot(
  target: string,
  dependencies: CaptureDependencies = {},
): Promise<Buffer> {
  const deadlineController = new AbortController();
  const timeout = setTimeout(() => deadlineController.abort(), CAPTURE_TIMEOUT_MS);
  timeout.unref();
  const externalSignal = dependencies.signal;
  const abortFromCaller = () => deadlineController.abort();
  externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
  if (externalSignal?.aborted) deadlineController.abort();

  const signal = deadlineController.signal;
  const deadline = Date.now() + CAPTURE_TIMEOUT_MS;
  const launchBrowser =
    dependencies.launchBrowser ??
    ((options: {
      headless: true;
      proxy: { server: string };
      args: string[];
    }) => chromium.launch(options));
  const beginProxy = dependencies.startProxy ?? startValidatingProxy;
  const normalizeImage = dependencies.normalizeImage ?? normalizeScreenshot;
  const waitAfterLoad = dependencies.settle ?? settle;
  const validateUrl: ValidateUrl =
    dependencies.validateUrl ??
    ((url, count) => validatePublicHttpUrl(url, dependencies.resolver, count));

  let proxy: ValidatingProxy | undefined;
  let browser: BrowserLike | undefined;
  let context: BrowserContextLike | undefined;
  let page: PageLike | undefined;
  let stage: 'setup' | 'navigation' | 'render' = 'setup';
  let routedFailure: SnapshotCaptureError | undefined;
  const markRoutedFailure = (error: SnapshotCaptureError) => {
    routedFailure ??= error;
    proxy?.block(error);
  };

  try {
    let normalizedTarget: string;
    try {
      normalizedTarget = await withAbort(validateUrl(target, 0), signal);
    } catch (error) {
      if (isTimeoutError(error, signal)) throw new SnapshotCaptureError('timeout');
      if (error instanceof SnapshotCaptureError) throw error;
      throw new SnapshotCaptureError('blocked_target');
    }

    proxy = await withAbort(
      beginProxy({
        addressResolver: dependencies.resolver,
        signal,
        onFailure: (error) => {
          routedFailure ??= error;
        },
      }),
      signal,
    );
    browser = await withAbort(
      launchBrowser({
        headless: true,
        proxy: { server: proxy.url },
        args: [
          '--disable-quic',
          '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
          '--host-resolver-rules=MAP * ~NOTFOUND',
          '--proxy-bypass-list=<-loopback>',
        ],
      }),
      signal,
    );
    context = await withAbort(
      browser.newContext({
        viewport: { width: CAPTURE_WIDTH, height: CAPTURE_HEIGHT },
        acceptDownloads: false,
        ignoreHTTPSErrors: false,
        serviceWorkers: 'block',
      }),
      signal,
    );
    const routeHttp = async (route: RouteLike) => {
      const browserRequest = route.request();
      const depth = redirectDepth(browserRequest);
      if (depth > 5) {
        markRoutedFailure(new SnapshotCaptureError('blocked_target'));
        await route.abort('blockedbyclient');
        return;
      }
      try {
        await withAbort(
          validateUrl(browserRequest.url(), depth),
          signal,
        );
      } catch (error) {
        markRoutedFailure(
          isTimeoutError(error, signal)
            ? new SnapshotCaptureError('timeout')
            : new SnapshotCaptureError('blocked_target'),
        );
        await route.abort('blockedbyclient');
        return;
      }
      await withAbort(route.continue(), signal);
    };
    const routePopup = async (route: RouteLike) => {
      const browserRequest = route.request();
      try {
        await withAbort(
          validateUrl(browserRequest.url(), redirectDepth(browserRequest)),
          signal,
        );
      } catch (error) {
        markRoutedFailure(
          isTimeoutError(error, signal)
            ? new SnapshotCaptureError('timeout')
            : new SnapshotCaptureError('blocked_target'),
        );
      }
      await route.abort('blockedbyclient');
    };
    const routeWebSocket = async (route: WebSocketRouteLike) => {
      try {
        await withAbort(validateUrl(route.url(), 0), signal);
      } catch (error) {
        markRoutedFailure(
          isTimeoutError(error, signal)
            ? new SnapshotCaptureError('timeout')
            : new SnapshotCaptureError('blocked_target'),
        );
        route.close();
        return;
      }
      // The public policy deliberately permits HTTP(S) only, so a custom
      // validator must not accidentally enable a separate WebSocket channel.
      markRoutedFailure(new SnapshotCaptureError('blocked_target'));
      route.close();
    };

    // Context routing catches the first request of popups; the page route is
    // retained as the primary interception path required by the service policy.
    await withAbort(context.route('**/*', routePopup), signal);
    await withAbort(context.routeWebSocket('**/*', routeWebSocket), signal);
    page = await withAbort(context.newPage(), signal);
    page.on('request', (browserRequest) => {
      if (redirectDepth(browserRequest) <= 5) return;
      markRoutedFailure(new SnapshotCaptureError('blocked_target'));
      void page?.close().catch(() => undefined);
    });
    page.on('popup', (popup) => {
      void popup.close().catch(() => undefined);
    });
    await withAbort(page.route('**/*', routeHttp), signal);
    await withAbort(page.routeWebSocket('**/*', routeWebSocket), signal);

    stage = 'navigation';
    const remainingNavigationMs = Math.max(1, deadline - Date.now());
    try {
      await withAbort(
        page.goto(normalizedTarget, {
          waitUntil: 'domcontentloaded',
          timeout: remainingNavigationMs,
        }),
        signal,
      );
    } catch (error) {
      if (routedFailure ?? proxy.failure) throw routedFailure ?? proxy.failure;
      if (isTimeoutError(error, signal)) throw new SnapshotCaptureError('timeout');
      throw new SnapshotCaptureError('navigation_failed');
    }
    if (routedFailure ?? proxy.failure) throw routedFailure ?? proxy.failure;

    await withAbort(waitAfterLoad(POST_LOAD_SETTLE_MS, signal), signal);
    if (routedFailure ?? proxy.failure) throw routedFailure ?? proxy.failure;

    stage = 'render';
    const png = await withAbort(
      page.screenshot({ type: 'png', fullPage: false }),
      signal,
    );
    const image = await withAbort(normalizeImage(png), signal);
    if (routedFailure ?? proxy.failure) throw routedFailure ?? proxy.failure;
    if (image.byteLength > MAX_IMAGE_BYTES) {
      throw new SnapshotCaptureError('image_too_large');
    }
    return image;
  } catch (error) {
    if (error instanceof SnapshotCaptureError) throw error;
    if (isTimeoutError(error, signal)) throw new SnapshotCaptureError('timeout');
    throw new SnapshotCaptureError(
      stage === 'navigation' ? 'navigation_failed' : 'render_failed',
    );
  } finally {
    await closeQuietly(page, signal);
    await closeQuietly(context, signal);
    await closeQuietly(browser, signal);
    await closeQuietly(proxy, signal);
    const deadlineExpiredDuringCleanup = signal.aborted;
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortFromCaller);
    if (deadlineExpiredDuringCleanup) {
      throw new SnapshotCaptureError('timeout');
    }
  }
}
