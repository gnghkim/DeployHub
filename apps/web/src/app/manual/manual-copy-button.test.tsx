// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ManualCopyButton } from './manual-copy-button';

describe('ManualCopyButton', () => {
  let container: HTMLDivElement;
  let initialClipboardDescriptor: PropertyDescriptor | undefined;
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
    initialClipboardDescriptor = Object.getOwnPropertyDescriptor(
      navigator,
      'clipboard',
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    if (initialClipboardDescriptor) {
      Object.defineProperty(
        navigator,
        'clipboard',
        initialClipboardDescriptor,
      );
    } else {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function renderButton(text = '등록 요청문') {
    await act(async () => root.render(<ManualCopyButton text={text} />));
  }

  function button() {
    return container.querySelector('button');
  }

  it('copies the complete prompt only after activation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    await renderButton();

    expect(writeText).not.toHaveBeenCalled();
    await act(async () => {
      button()?.click();
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText).toHaveBeenCalledWith('등록 요청문');
    expect(button()?.textContent).toBe('복사됨');
  });

  it('returns to the default label after two seconds', async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    await renderButton();

    await act(async () => {
      button()?.click();
      await Promise.resolve();
    });
    await act(async () => vi.advanceTimersByTimeAsync(2_000));

    expect(button()?.textContent).toBe('요청문 복사');
  });

  it.each([
    ['is unavailable', undefined],
    [
      'rejects the write',
      { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    ],
  ])('shows a safe message when clipboard %s', async (_name, clipboard) => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: clipboard,
    });
    await renderButton('노출하면 안 되는 요청문');

    await act(async () => {
      button()?.click();
      await Promise.resolve();
    });

    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      '복사하지 못했습니다. 직접 선택해 주세요.',
    );
    expect(container.textContent).not.toContain('denied');
  });
});
