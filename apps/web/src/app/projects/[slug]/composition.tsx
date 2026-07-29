import type { Composition } from './composition-model';
import { Annotation } from '../../../components/schematic/annotation';
import { Sheet } from '../../../components/schematic/sheet';

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
    <Sheet className="mt-5 min-w-0 overflow-hidden">
      {repository ? (
        <>
          <div className="inline-flex items-baseline gap-3 rounded-[var(--radius-card)] border border-[var(--rule)] bg-[var(--paper)] px-4 py-3">
            <span className="text-xs font-medium uppercase tracking-wide text-[var(--absent)]">
              GitHub
            </span>
            <span className="font-mono text-sm text-[var(--line)]">
              {repository}
            </span>
          </div>
          <TreeConnector />
        </>
      ) : null}

      <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--rule)] bg-[var(--paper)]">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--rule)] px-4 py-3">
          <p className="font-mono font-medium text-[var(--line)]">{deployment}</p>
          <p className="text-xs text-[var(--annotation)]">
            {providers.length > 0
              ? `선언: ${providers.join(' · ')}`
              : '배포 기반 선언 없음'}
          </p>
        </div>

        <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)] border-b border-[var(--rule)] px-4 py-2 text-xs text-[var(--absent)] md:grid">
          <span>선언</span>
          <span>관측</span>
        </div>

        {composition.rows.length > 0 ? (
          <ul className="divide-y divide-[var(--rule)]">
            {composition.rows.map((row) => (
              <li
                key={row.key}
                className="grid min-w-0 grid-cols-1 items-start gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-0"
              >
                <div className="min-w-0">
                  <p className="mb-1 text-xs font-medium text-[var(--absent)] md:hidden">
                    선언
                  </p>
                  <p className="truncate text-sm font-medium text-[var(--line)]">
                    {row.declaration.name}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-xs text-[var(--annotation)]">
                    {row.declaration.technology}
                  </p>
                </div>
                <div className="min-w-0 space-y-2 border-l border-[var(--rule)] pl-3 md:border-l-0 md:pl-0">
                  <p className="text-xs font-medium text-[var(--absent)] md:hidden">
                    관측
                  </p>
                  {row.observations.map((observation) => (
                    <div className="min-w-0 break-all" key={observation.key}>
                      <Annotation
                        value={observation.name === null
                          ? null
                          : [
                            observation.name,
                            observation.provider,
                            observation.status,
                          ].filter(Boolean).join(' · ')}
                      />
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-6 text-sm text-[var(--annotation)]">
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
                className="rounded-[var(--radius-card)] border border-[var(--rule)] bg-[var(--paper)] px-4 py-3"
              >
                <p className="font-mono text-sm text-[var(--line)]">
                  {domain.domain}
                </p>
                <p className="mt-0.5 font-mono text-xs text-[var(--annotation)]">
                  {domain.environment}
                </p>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </Sheet>
  );
}

function TreeConnector() {
  return (
    <div
      aria-hidden="true"
      className="ml-6 flex h-10 w-4 flex-col items-center text-[var(--absent)]"
    >
      <span className="h-6 border-l border-[var(--absent)]" />
      <span className="-mt-1">▼</span>
    </div>
  );
}
