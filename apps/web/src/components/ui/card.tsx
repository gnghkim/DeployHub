import type { ComponentPropsWithoutRef } from 'react';

export function Card({ className = '', ...props }: ComponentPropsWithoutRef<'section'>) {
  return (
    <section
      className={`rounded-[var(--radius-card)] border border-[var(--color-hairline)] bg-[var(--color-surface)] p-5 ${className}`}
      {...props}
    />
  );
}
