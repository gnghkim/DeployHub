type BackendSummaryInput = {
  observedProviders: Iterable<string>;
  declaredProviders: Iterable<string | null>;
};

export function summarizeBackend({
  observedProviders,
  declaredProviders,
}: BackendSummaryInput): string {
  const observed = new Set(observedProviders);
  const hasDocker = observed.has('docker');
  const hasVercel = observed.has('vercel');

  if (hasDocker && hasVercel) return 'Vercel + VPS';
  if (hasDocker) return 'VPS 단독';
  if (hasVercel) return 'Vercel';

  const declared = [...new Set(
    [...declaredProviders].flatMap((provider) => {
      const value = provider?.trim();
      return value ? [value] : [];
    }),
  )].sort();
  return declared.length === 0
    ? '미확인'
    : `미확인 (선언: ${declared.join(', ')})`;
}

export function shortContainerId(id: string): string {
  return id.slice(0, 12);
}

export function formatRelativeTime(
  value: Date,
  now = new Date(),
): string {
  const elapsedMs = Math.max(0, now.getTime() - value.getTime());
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;

  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}
