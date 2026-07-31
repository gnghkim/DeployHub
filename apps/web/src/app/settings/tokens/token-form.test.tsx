// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RawTokenNotice } from './token-form';

vi.mock('../../../actions/tokens', () => ({
  issueRegistrationToken: vi.fn(),
}));

const RAW_TOKEN = 'dhreg_super-secret-token';

describe('RawTokenNotice', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function renderNotice(rawToken?: string) {
    await act(async () => root.render(<RawTokenNotice rawToken={rawToken} />));
  }

  function copyButton() {
    return Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '복사',
    );
  }

  it('shows the copy button only while a raw token is displayed', async () => {
    await renderNotice();

    expect(container.querySelector('code')).toBeNull();
    expect(container.querySelector('button')).toBeNull();

    await renderNotice(RAW_TOKEN);

    expect(container.querySelector('code')?.textContent).toBe(RAW_TOKEN);
    expect(copyButton()).toBeDefined();
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(
      '복사',
    );
  });

  it('copies the exact raw token only after the button is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    await renderNotice(RAW_TOKEN);

    expect(writeText).not.toHaveBeenCalled();

    await act(async () => {
      copyButton()?.click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith(RAW_TOKEN);
  });

  it('shows success and returns to the default state after two seconds', async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    await renderNotice(RAW_TOKEN);

    await act(async () => {
      copyButton()?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(
      '복사됨',
    );
    expect(container.querySelector('code')?.textContent).toBe(RAW_TOKEN);

    await act(async () => vi.advanceTimersByTimeAsync(1_999));
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(
      '복사됨',
    );

    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(
      '복사',
    );
    expect(container.querySelector('code')?.textContent).toBe(RAW_TOKEN);
  });

  it('shows failure and retains the raw token when clipboard writing rejects', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    await renderNotice(RAW_TOKEN);

    await act(async () => {
      copyButton()?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(
      '복사 실패',
    );
    expect(container.querySelector('code')?.textContent).toBe(RAW_TOKEN);
  });

  it('shows failure without leaking an exception when clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    await renderNotice(RAW_TOKEN);

    await expect(
      act(async () => {
        copyButton()?.click();
        await Promise.resolve();
      }),
    ).resolves.toBeUndefined();

    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe(
      '복사 실패',
    );
    expect(container.querySelector('code')?.textContent).toBe(RAW_TOKEN);
  });

  it('renders the raw token only as code and never in an attribute', async () => {
    await renderNotice(RAW_TOKEN);

    expect(container.querySelector('code')?.textContent).toBe(RAW_TOKEN);
    expect(container.innerHTML.split(RAW_TOKEN)).toHaveLength(2);

    for (const element of container.querySelectorAll('*')) {
      for (const attribute of element.attributes) {
        expect(attribute.value).not.toContain(RAW_TOKEN);
      }
    }
  });
});
