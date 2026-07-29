import type { ComponentPropsWithoutRef } from 'react';

export function Input({ className = '', ...props }: ComponentPropsWithoutRef<'input'>) {
  return (
    <input
      className={`h-9 w-full rounded-[var(--radius-button)] border border-[var(--rule)] bg-[var(--paper)] px-3 text-sm text-[var(--line)] outline-none placeholder:text-[var(--absent)] focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    />
  );
}
