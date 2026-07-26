import type { Tone } from './badge';

const TONES: Record<Tone, string> = {
  success: 'bg-[var(--color-success)]',
  warning: 'bg-[var(--color-warning)]',
  error: 'bg-[var(--color-error)]',
  info: 'bg-[var(--color-info)]',
  neutral: 'bg-[var(--color-ash)]',
};

export function StatusDot({ tone = 'neutral', label }: { tone?: Tone; label?: string }) {
  return (
    <span
      aria-label={label}
      aria-hidden={label === undefined}
      className={`inline-block size-2 shrink-0 rounded-full ${TONES[tone]}`}
    />
  );
}
