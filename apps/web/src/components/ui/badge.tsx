import type { ReactNode } from 'react';

const TONES = {
  success: 'text-[var(--color-success)]',
  warning: 'text-[var(--color-warning)]',
  error: 'text-[var(--color-error)]',
  info: 'text-[var(--color-info)]',
  neutral: 'text-[var(--color-mute)]',
} as const;

export type Tone = keyof typeof TONES;

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-[var(--radius-badge)] border border-[var(--color-hairline)] bg-[var(--color-surface-elevated)] px-1.5 py-0.5 text-xs ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}
