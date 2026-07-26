import type { ComponentPropsWithoutRef } from 'react';

const VARIANTS = {
  primary:
    'border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-canvas)] hover:bg-[var(--color-body)]',
  secondary:
    'border-[var(--color-hairline)] bg-[var(--color-surface-elevated)] text-[var(--color-ink)] hover:bg-[var(--color-surface-card)]',
  tertiary:
    'border-transparent bg-transparent text-[var(--color-body)] hover:border-[var(--color-hairline)] hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-ink)]',
} as const;

export type ButtonVariant = keyof typeof VARIANTS;

type ButtonProps = ComponentPropsWithoutRef<'button'> & {
  variant?: ButtonVariant;
};

export function Button({ variant = 'secondary', className = '', type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex h-9 items-center justify-center rounded-[var(--radius-button)] border px-3 text-sm font-medium transition-colors focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-info)] disabled:pointer-events-none disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
