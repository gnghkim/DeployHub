import type { ComponentPropsWithoutRef } from 'react';

export function Input({ className = '', ...props }: ComponentPropsWithoutRef<'input'>) {
  return (
    <input
      className={`h-9 w-full rounded-[var(--radius-button)] border border-[var(--color-hairline)] bg-[var(--color-surface-elevated)] px-3 text-sm text-[var(--color-ink)] outline-none placeholder:text-[var(--color-ash)] focus:border-[var(--color-info)] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    />
  );
}
