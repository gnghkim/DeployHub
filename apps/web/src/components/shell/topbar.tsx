export function Topbar({ title }: { title: string }) {
  return (
    <header className="flex h-16 items-center border-b border-[var(--rule)] px-4 pl-16 md:px-8">
      <h1 className="text-xl font-semibold tracking-tight text-[var(--line)]">{title}</h1>
    </header>
  );
}
