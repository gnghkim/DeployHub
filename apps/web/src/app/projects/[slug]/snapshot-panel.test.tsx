// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock('next/image', () => ({
  default: (props: React.ComponentPropsWithoutRef<'img'>) => <img {...props} />,
}));

import { SnapshotPanel, type SnapshotPanelProps } from './snapshot-panel';
import {
  SnapshotSettingsForm,
  validateSnapshotUrl,
} from './snapshot-settings-form';

const baseProps: SnapshotPanelProps = {
  slug: 'yield',
  mode: 'automatic',
  snapshotUrl: 'https://yield.example.com/',
  snapshot: {
    hasImage: true,
    source: 'automatic',
    capturedAt: '2026-08-02T01:02:03.000Z',
    checksum: 'checksum/value',
    lastAttemptAt: '2026-08-02T02:03:04.000Z',
    lastAttemptStatus: 'success',
    lastError: null,
  },
};

let container: HTMLDivElement;
let root: Root;

async function render(node: React.ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

function buttons() {
  return Array.from(container.querySelectorAll('button'));
}

function button(label: string) {
  const match = buttons().find((candidate) => candidate.textContent?.trim() === label);
  if (!match) throw new Error(`missing button: ${label}`);
  return match;
}

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('SnapshotPanel', () => {
  it('shows the current image metadata and a failed latest attempt together', async () => {
    await render(<SnapshotPanel {...baseProps} snapshot={{
      ...baseProps.snapshot,
      lastAttemptStatus: 'failed',
      lastError: 'navigation_failed',
    }} />);

    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toBe(
      '/api/projects/yield/snapshot?checksum=checksum%2Fvalue',
    );
    expect(container.textContent).toContain('자동 캡처');
    expect(container.querySelector('time')?.dateTime).toBe('2026-08-02T01:02:03.000Z');
    expect(container.textContent).toContain('navigation_failed');
    expect(image).not.toBeNull();
  });

  it.each([
    ['disabled', ['이미지 업로드'], ['지금 캡처', '자동 캡처 재개', '이미지 교체', '스냅샷 삭제']],
    ['automatic', ['지금 캡처', '이미지 업로드', '스냅샷 삭제'], ['자동 캡처 재개', '이미지 교체']],
    ['manual', ['자동 캡처 재개', '이미지 교체', '스냅샷 삭제'], ['지금 캡처', '이미지 업로드']],
  ] as const)('renders the exact %s action matrix', async (mode, present, absent) => {
    await render(<SnapshotPanel {...baseProps} mode={mode} />);

    for (const label of present) expect(container.textContent).toContain(label);
    for (const label of absent) expect(container.textContent).not.toContain(label);
    const settingsLink = container.querySelector(`a[href="/projects/yield/edit"]`);
    expect(settingsLink !== null).toBe(mode === 'disabled');
  });

  it('accepts only supported image types and states the five megabyte limit', async () => {
    await render(<SnapshotPanel {...baseProps} />);

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input?.accept).toBe('image/png,image/jpeg,image/webp');
    expect(container.textContent).toContain('5 MB');
  });

  it('disables controls while pending, announces success, and refreshes', async () => {
    let resolve!: (response: Response) => void;
    const request = new Promise<Response>((settle) => { resolve = settle; });
    const fetch = vi.fn().mockReturnValue(request);
    vi.stubGlobal('fetch', fetch);
    await render(<SnapshotPanel {...baseProps} />);

    await act(async () => {
      button('지금 캡처').click();
      await Promise.resolve();
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/projects/yield/snapshot/capture',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(buttons().every((candidate) => candidate.disabled)).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[type="file"]')?.disabled).toBe(true);

    await act(async () => {
      resolve(Response.json({ queued: true }, { status: 202 }));
      await request;
      await Promise.resolve();
    });
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain('요청');
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('announces a safe fallback for malformed and network errors without refreshing', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response('{', {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }))
      .mockRejectedValueOnce(new Error('secret network detail'));
    vi.stubGlobal('fetch', fetch);
    await render(<SnapshotPanel {...baseProps} />);

    await act(async () => {
      button('지금 캡처').click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain('완료하지 못했습니다');

    await act(async () => {
      button('지금 캡처').click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain('완료하지 못했습니다');
    expect(container.textContent).not.toContain('secret network detail');
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('rejects unsupported or oversized files before upload', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await render(<SnapshotPanel {...baseProps} />);
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;

    const invalid = new File(['text'], 'notes.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { configurable: true, value: [invalid] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(fetch).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain('PNG, JPEG 또는 WebP');

    const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', {
      type: 'image/png',
    });
    Object.defineProperty(input, 'files', { configurable: true, value: [oversized] });
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
    expect(fetch).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain('5 MB');
  });
});

describe('SnapshotSettingsForm', () => {
  function urlInput() {
    return container.querySelector<HTMLInputElement>('input[name="snapshotUrl"]')!;
  }

  async function setUrl(value: string) {
    const input = urlInput();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
        ?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function submitSettings() {
    await act(async () => {
      container.querySelector('form')?.dispatchEvent(new Event('submit', {
        bubbles: true,
        cancelable: true,
      }));
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('exposes the representative URL and automatic toggle without promising authenticated capture', async () => {
    await render(<SnapshotSettingsForm
      slug="yield"
      mode="disabled"
      snapshotUrl="https://yield.example.com/"
    />);

    expect(container.querySelector<HTMLInputElement>('input[name="snapshotUrl"]')?.value)
      .toBe('https://yield.example.com/');
    expect(container.querySelector<HTMLInputElement>('input[name="automatic"]')?.checked)
      .toBe(false);
    expect(container.textContent).toContain('공개 페이지');
    expect(container.textContent).toContain('로그인 후');
  });

  it('saves settings as JSON and refreshes after success', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    await render(<SnapshotSettingsForm
      slug="yield"
      mode="disabled"
      snapshotUrl="https://yield.example.com/"
    />);
    const toggle = container.querySelector<HTMLInputElement>('input[name="automatic"]')!;
    toggle.click();

    await submitSettings();

    expect(fetch).toHaveBeenCalledWith(
      '/api/projects/yield/snapshot/settings',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'automatic',
          url: 'https://yield.example.com/',
        }),
      }),
    );
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain('저장');
  });

  it.each([
    ['missing URL', '', '대표 URL'],
    ['non-HTTP protocol', 'ftp://example.com/', 'HTTP'],
    ['credentials', 'https://user:secret@example.com/', 'HTTP'],
    ['wrong HTTP port', 'http://example.com:443/', '80'],
    ['wrong HTTPS port', 'https://example.com:80/', '443'],
    ['nonstandard port', 'https://example.com:8443/', '443'],
    ['fragment', 'https://example.com/app#private', '조각'],
    ['invalid URL', 'not a URL', 'HTTP'],
    ['overlong URL', `https://example.com/${'a'.repeat(2_100)}`, '2,048'],
  ])('rejects automatic %s before fetch and focuses the described field', async (
    _name,
    value,
    expectedError,
  ) => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await render(<SnapshotSettingsForm
      slug="yield"
      mode="automatic"
      snapshotUrl="https://yield.example.com/"
    />);
    await setUrl(value);
    await submitSettings();

    const input = urlInput();
    const errorId = input.getAttribute('aria-describedby')?.split(' ').at(-1);
    expect(fetch).not.toHaveBeenCalled();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(errorId).toBeTruthy();
    expect(document.getElementById(errorId!)?.textContent).toContain(expectedError);
    expect(document.activeElement).toBe(input);
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('');
  });

  it('rejects surrounding whitespace using the same raw-value policy as the server', () => {
    expect(validateSnapshotUrl(' https://example.com/ ', true)).toEqual({
      ok: false,
      error: '대표 URL 앞뒤에 공백을 입력할 수 없습니다.',
    });
  });

  it.each([
    ['http://example.com:80/app', 'http://example.com/app'],
    ['https://example.com:443/app', 'https://example.com/app'],
  ])('accepts and normalizes a valid default-port URL', async (value, normalized) => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    await render(<SnapshotSettingsForm slug="yield" mode="automatic" snapshotUrl={value} />);
    await submitSettings();

    expect(fetch).toHaveBeenCalledWith(
      '/api/projects/yield/snapshot/settings',
      expect.objectContaining({
        body: JSON.stringify({ mode: 'automatic', url: normalized }),
      }),
    );
    expect(urlInput().getAttribute('aria-invalid')).toBe('false');
  });

  it('allows an empty URL while disabled but validates a supplied disabled URL', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal('fetch', fetch);
    await render(<SnapshotSettingsForm slug="yield" mode="disabled" snapshotUrl={null} />);

    await submitSettings();
    expect(fetch).toHaveBeenLastCalledWith(
      '/api/projects/yield/snapshot/settings',
      expect.objectContaining({
        body: JSON.stringify({ mode: 'disabled', url: null }),
      }),
    );

    fetch.mockClear();
    await setUrl('https://example.com:8443/');
    await submitSettings();
    expect(fetch).not.toHaveBeenCalled();
    expect(urlInput().getAttribute('aria-invalid')).toBe('true');
  });

  it.each(['invalid_settings', 'Invalid settings'])(
    'maps server %s to a safe URL field error',
    async (serverError) => {
      const fetch = vi.fn().mockResolvedValue(Response.json(
        { error: serverError, internal: 'https://secret.example/token' },
        { status: 400 },
      ));
      vi.stubGlobal('fetch', fetch);
      await render(<SnapshotSettingsForm
        slug="yield"
        mode="automatic"
        snapshotUrl="https://yield.example.com/"
      />);
      await submitSettings();

      const input = urlInput();
      const describedBy = input.getAttribute('aria-describedby') ?? '';
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(container.textContent).toContain('HTTP');
      expect(describedBy).toContain('snapshot-url-error');
      expect(document.activeElement).toBe(input);
      expect(container.textContent).not.toContain('secret.example');
      expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('');
    },
  );
});
