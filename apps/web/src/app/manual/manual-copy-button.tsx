'use client';

import { useEffect, useState } from 'react';

type CopyState = 'idle' | 'copied' | 'failed';

export function ManualCopyButton({ text }: { text: string }) {
  const [state, setState] = useState<CopyState>('idle');

  useEffect(() => {
    if (state !== 'copied') return;

    const timeout = window.setTimeout(() => setState('idle'), 2_000);
    return () => window.clearTimeout(timeout);
  }, [state]);

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={copy}
        className="rounded-[var(--radius-button)] border border-[var(--rule)] px-3 py-2 text-sm font-medium text-[var(--line)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
      >
        {state === 'copied' ? '복사됨' : '요청문 복사'}
      </button>
      <span
        role="status"
        aria-live="polite"
        className="text-xs text-[var(--annotation)]"
      >
        {state === 'failed'
          ? '복사하지 못했습니다. 직접 선택해 주세요.'
          : ''}
      </span>
    </div>
  );
}
