export type ObservationComponent = {
  provider: string | null;
  externalRef: string | null;
  containerName: string | null;
  updatedAt: Date;
};

export type ObservationContext = {
  accounts: Array<{
    id: string;
    provider: 'vercel' | 'supabase';
    lastSyncAt: Date | null;
    lastError: string | null;
  }>;
  activeJobs: Array<{
    type: string;
    payload: Record<string, unknown>;
  }>;
  dockerLastSyncAt: Date | null;
};

export type MissingObservation = {
  label: string;
  detail: string | null;
};

function accountId(payload: Record<string, unknown>): string | null {
  return typeof payload.accountId === 'string' ? payload.accountId : null;
}

export function describeMissingObservation(
  component: ObservationComponent,
  context: ObservationContext,
): MissingObservation {
  if (component.containerName !== null) {
    if (context.activeJobs.some(({ type }) => type === 'docker.sync')) {
      return { label: '동기화 대기', detail: null };
    }
    return context.dockerLastSyncAt !== null
      && context.dockerLastSyncAt.getTime() >= component.updatedAt.getTime()
      ? { label: '관측되지 않음', detail: null }
      : { label: '동기화 필요', detail: null };
  }

  if (component.provider !== 'vercel' && component.provider !== 'supabase') {
    return { label: '연결 필요', detail: null };
  }
  const accounts = context.accounts.filter(
    ({ provider }) => provider === component.provider,
  );
  if (accounts.length === 0) {
    return { label: '연결 필요', detail: null };
  }
  const ids = new Set(accounts.map(({ id }) => id));
  if (context.activeJobs.some((job) => (
    job.type === `${component.provider}.sync`
    && ids.has(accountId(job.payload) ?? '')
  ))) {
    return { label: '동기화 대기', detail: null };
  }
  const newestSync = accounts.reduce<Date | null>((latest, account) => (
    account.lastError === null
      && account.lastSyncAt !== null
      && (latest === null || account.lastSyncAt.getTime() > latest.getTime())
      ? account.lastSyncAt
      : latest
  ), null);
  if (
    newestSync !== null
    && newestSync.getTime() >= component.updatedAt.getTime()
  ) {
    return { label: '관측되지 않음', detail: null };
  }
  const error = accounts.find(
    ({ lastError }) => lastError !== null,
  )?.lastError ?? null;
  return { label: '동기화 필요', detail: error };
}
