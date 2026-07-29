import type { ComponentPropsWithoutRef } from 'react';

export function Card({ className = '', ...props }: ComponentPropsWithoutRef<'section'>) {
  return (
    <section
      className={`rounded-[var(--radius-card)] border border-[var(--rule)] bg-[var(--paper)] p-5 ${className}`}
      {...props}
    />
  );
}
