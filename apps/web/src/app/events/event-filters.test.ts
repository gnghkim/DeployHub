import { describe, expect, it } from 'vitest';

import { buildEventsHref, parseEventFilters } from './event-filters';

const projects = [
  { id: 'project-1', slug: 'deployhub', name: 'DeployHub' },
  { id: 'project-2', slug: 'other', name: 'Other Project' },
];

describe('event filters', () => {
  it('parses valid combined filters', () => {
    expect(parseEventFilters({
      project: 'deployhub',
      severity: 'critical',
      kind: 'health_status',
      cursor: '42',
    }, projects)).toEqual({
      projectSlug: 'deployhub',
      projectId: 'project-1',
      severity: 'critical',
      kind: 'health_status',
      cursor: 42n,
    });
  });

  it('ignores invalid fields independently', () => {
    expect(parseEventFilters({
      project: 'missing',
      severity: 'urgent',
      kind: ['deployment'],
      cursor: '-1',
    }, projects)).toEqual({
      projectSlug: '',
      projectId: null,
      severity: undefined,
      kind: undefined,
      cursor: undefined,
    });
  });

  it.each(['0', '-2', '1.2', 'abc', '', '9223372036854775808'])(
    'rejects invalid cursor %j',
    (cursor) => {
      expect(parseEventFilters({ cursor }, projects).cursor).toBeUndefined();
    },
  );

  it('builds a stable, encoded events URL', () => {
    expect(buildEventsHref({
      projectSlug: 'deploy hub',
      severity: 'warning',
      kind: 'sync_failure',
    }, 77n)).toBe('/events?project=deploy+hub&severity=warning&kind=sync_failure&cursor=77');
  });

  it('builds the base events URL for an empty selection', () => {
    expect(buildEventsHref({
      projectSlug: '',
      severity: undefined,
      kind: undefined,
    })).toBe('/events');
  });
});
