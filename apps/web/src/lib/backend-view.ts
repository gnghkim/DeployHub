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

  // M2 의 수집기는 docker 와 vercel 만 만들지만 M4 에서 supabase 와
  // hostinger 가 붙는다. 그때 여기서 걸러지면 관측을 해 놓고도 '미확인'
  // 이라고 쓰게 된다. 관측한 것이 있으면 이름 그대로라도 사실로 적는다.
  // 관측이 정말 없을 때만 아래 선언 분기로 내려간다.
  const others = [...observed].map((p) => p.trim()).filter(Boolean).sort();
  if (others.length > 0) return others.join(' + ');

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
