import { schema } from '@deployhub/db';

const { changeEventKind, eventSeverity } = schema;

const MAX_CURSOR = 9_223_372_036_854_775_807n;

export type RawEventSearchParams = Record<string, string | string[] | undefined>;

export type EventProjectOption = {
  id: string;
  slug: string;
  name: string;
};

export type EventSeverity = (typeof eventSeverity.enumValues)[number];
export type EventKind = (typeof changeEventKind.enumValues)[number];

export type EventFilters = {
  projectSlug: string;
  projectId: string | null;
  severity: EventSeverity | undefined;
  kind: EventKind | undefined;
  cursor: bigint | undefined;
};

export type EventFilterSelection = Pick<EventFilters, 'projectSlug' | 'severity' | 'kind'>;

function scalarValue(raw: RawEventSearchParams, key: string): string | undefined {
  const value = raw[key];
  return typeof value === 'string' ? value : undefined;
}

function enumValue<T extends readonly string[]>(
  value: string | undefined,
  values: T,
): T[number] | undefined {
  return value !== undefined && values.includes(value) ? value : undefined;
}

function parseCursor(value: string | undefined): bigint | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;

  const cursor = BigInt(value);
  return cursor > 0n && cursor <= MAX_CURSOR ? cursor : undefined;
}

export function parseEventFilters(
  raw: RawEventSearchParams,
  projects: EventProjectOption[],
): EventFilters {
  const project = projects.find(({ slug }) => slug === scalarValue(raw, 'project'));

  return {
    projectSlug: project?.slug ?? '',
    projectId: project?.id ?? null,
    severity: enumValue(scalarValue(raw, 'severity'), eventSeverity.enumValues),
    kind: enumValue(scalarValue(raw, 'kind'), changeEventKind.enumValues),
    cursor: parseCursor(scalarValue(raw, 'cursor')),
  };
}

export function buildEventsHref(filters: EventFilterSelection, cursor?: bigint): string {
  const params = new URLSearchParams();

  if (filters.projectSlug) params.set('project', filters.projectSlug);
  if (filters.severity) params.set('severity', filters.severity);
  if (filters.kind) params.set('kind', filters.kind);
  if (cursor !== undefined) params.set('cursor', cursor.toString());

  const query = params.toString();
  return query ? `/events?${query}` : '/events';
}
