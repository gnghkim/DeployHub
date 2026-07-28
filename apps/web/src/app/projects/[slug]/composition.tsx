import type { Composition } from './composition-model';

export {
  buildComposition,
  isComponentObservationResource,
  type CompositionInput,
} from './composition-model';

export function ArchitectureComposition({
  composition,
  repository,
  deployment,
  declaredProviders,
  domains,
}: {
  composition: Composition;
  repository: string | null;
  deployment: string;
  declaredProviders: string[];
  domains: Array<{
    id: string;
    domain: string;
    environment: string;
  }>;
}) {
  const providers = [...new Set(
    declaredProviders.flatMap((provider) => {
      const value = provider.trim();
      return value ? [value] : [];
    }),
  )].sort((left, right) => left.localeCompare(right, 'en'));
  const sortedDomains = [...domains].sort((left, right) => (
    left.domain.localeCompare(right.domain, 'en')
    || left.environment.localeCompare(right.environment, 'en')
  ));

  return (
    <div className="mt-5">
      {repository ? (
        <>
          <div className="inline-flex items-baseline gap-3 rounded-[var(--radius-card)] border border-[var(--color-hairline)] bg-[var(--color-surface-elevated)] px-4 py-3">
            <span className="text-xs font-medium uppercase tracking-wide text-[var(--color-ash)]">
              GitHub
            </span>
            <span className="font-mono text-sm text-[var(--color-ink)]">
              {repository}
            </span>
          </div>
          <TreeConnector />
        </>
      ) : null}

      <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-hairline)] bg-[var(--color-surface-elevated)]">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-hairline)] px-4 py-3">
          <p className="font-medium text-[var(--color-ink)]">{deployment}</p>
          <p className="text-xs text-[var(--color-mute)]">
            {providers.length > 0
              ? `선언: ${providers.join(' · ')}`
              : '배포 기반 선언 없음'}
          </p>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)_2rem_minmax(0,1fr)] border-b border-[var(--color-hairline)] px-4 py-2 text-xs text-[var(--color-ash)]">
          <span>선언</span>
          <span aria-hidden="true" />
          <span>관측</span>
        </div>

        {composition.rows.length > 0 ? (
          <ul className="divide-y divide-[var(--color-hairline)]">
            {composition.rows.map((row) => (
              <li
                key={row.key}
                className="grid grid-cols-[minmax(0,1fr)_2rem_minmax(0,1fr)] items-start px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--color-ink)]">
                    {row.declaration.name}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-[var(--color-mute)]">
                    {row.declaration.technology}
                  </p>
                </div>
                <span
                  aria-hidden="true"
                  className="pt-1 text-center text-[var(--color-stone)]"
                >
                  →
                </span>
                <div className="min-w-0 space-y-2">
                  {row.observations.map((observation) => (
                    <div key={observation.key}>
                      <p className={
                        observation.missing
                          ? 'text-sm text-[var(--color-ash)]'
                          : 'truncate font-mono text-sm text-[var(--color-body)]'
                      }>
                        {observation.name}
                      </p>
                      {!observation.missing ? (
                        <p className="mt-0.5 text-xs text-[var(--color-mute)]">
                          {[
                            observation.provider,
                            observation.status ?? '상태 미확인',
                          ].filter(Boolean).join(' · ')}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-6 text-sm text-[var(--color-mute)]">
            등록된 구성요소가 없습니다.
          </p>
        )}
      </div>

      {sortedDomains.length > 0 ? (
        <>
          <TreeConnector />
          <div className="flex flex-wrap gap-2">
            {sortedDomains.map((domain) => (
              <div
                key={domain.id}
                className="rounded-[var(--radius-card)] border border-[var(--color-hairline)] bg-[var(--color-surface-elevated)] px-4 py-3"
              >
                <p className="font-mono text-sm text-[var(--color-ink)]">
                  {domain.domain}
                </p>
                <p className="mt-0.5 text-xs text-[var(--color-mute)]">
                  {domain.environment}
                </p>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function TreeConnector() {
  return (
    <div
      aria-hidden="true"
      className="ml-6 flex h-10 w-4 flex-col items-center text-[var(--color-stone)]"
    >
      <span className="h-6 border-l border-[var(--color-stone)]" />
      <span className="-mt-1">▼</span>
    </div>
  );
}
