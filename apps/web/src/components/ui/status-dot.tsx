import type { Tone } from './badge';

const TONES: Record<Tone, string> = {
  fault: 'bg-[var(--fault)]',
  caution: 'bg-[var(--caution)]',
  confirm: 'bg-[var(--confirm)]',
  accent: 'bg-[var(--accent)]',
  neutral: 'bg-[var(--absent)]',
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
