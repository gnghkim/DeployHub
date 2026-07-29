import type { ReactNode } from 'react';

const TONES = {
  success: 'text-[var(--confirm)]',
  warning: 'text-[var(--caution)]',
  error: 'text-[var(--fault)]',
  info: 'text-[var(--accent)]',
  neutral: 'text-[var(--annotation)]',
} as const;

export type Tone = keyof typeof TONES;

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-[var(--radius-button)] border border-[var(--rule)] bg-[var(--paper)] px-1.5 py-0.5 text-xs ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
