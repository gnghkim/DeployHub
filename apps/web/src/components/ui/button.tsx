import type { ComponentPropsWithoutRef } from 'react';

const VARIANTS = {
  primary:
    'border-[var(--line)] bg-[var(--line)] text-[var(--canvas)] hover:bg-[var(--line-mute)]',
  secondary:
    'border-[var(--rule)] bg-[var(--paper)] text-[var(--line)] hover:bg-white/[0.02]',
  tertiary:
    'border-transparent bg-transparent text-[var(--line-mute)] hover:border-[var(--rule)] hover:bg-white/[0.02] hover:text-[var(--line)]',
} as const;

export type ButtonVariant = keyof typeof VARIANTS;

type ButtonProps = ComponentPropsWithoutRef<'button'> & {
  variant?: ButtonVariant;
};

export function Button({ variant = 'secondary', className = '', type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex h-9 items-center justify-center rounded-[var(--radius-button)] border px-3 text-sm font-medium transition-colors focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:pointer-events-none disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
