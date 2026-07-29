import type { ReactNode } from 'react';

export function Sheet({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`sheet rounded-[var(--radius-card)] border border-[var(--rule)] p-4 md:p-5 ${className}`}
    >
      {children}
    </section>
  );
}
