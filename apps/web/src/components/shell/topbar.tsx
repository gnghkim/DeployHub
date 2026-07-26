export function Topbar({ title }: { title: string }) {
  return (
    <header className="flex h-16 items-center border-b border-[var(--color-hairline)] px-8">
      <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-ink)]">{title}</h1>
    </header>
  );
}
