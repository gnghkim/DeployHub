import type { ComponentPropsWithoutRef } from 'react';

export function Table({ className = '', ...props }: ComponentPropsWithoutRef<'table'>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={`w-full border-collapse text-left text-sm ${className}`} {...props} />
    </div>
  );
}

export function TableHeader({ className = '', ...props }: ComponentPropsWithoutRef<'thead'>) {
  return <thead className={`text-xs text-[var(--color-mute)] ${className}`} {...props} />;
}

export function TableBody({ className = '', ...props }: ComponentPropsWithoutRef<'tbody'>) {
  return <tbody className={className} {...props} />;
}

export function TableRow({ className = '', ...props }: ComponentPropsWithoutRef<'tr'>) {
  return (
    <tr
      className={`border-b border-[var(--color-hairline)] transition-colors hover:bg-[var(--color-surface-card)] aria-selected:bg-[var(--color-surface-card)] ${className}`}
      {...props}
    />
  );
}

export function TableHead({ className = '', ...props }: ComponentPropsWithoutRef<'th'>) {
  return <th className={`h-10 px-3 font-medium ${className}`} {...props} />;
}

export function TableCell({ className = '', ...props }: ComponentPropsWithoutRef<'td'>) {
  return <td className={`h-11 px-3 text-[var(--color-body)] ${className}`} {...props} />;
}
