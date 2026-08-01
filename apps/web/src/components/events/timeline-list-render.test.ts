// @vitest-environment happy-dom

import type { TimelineEvent } from '@deployhub/db';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TimelineList } from './timeline-list';

const occurredAt = new Date('2026-08-01T00:00:00.000Z');
const renderedAt = new Date('2026-08-01T00:01:00.000Z');

function event(id: string, projectId: string | null): TimelineEvent {
  return {
    id,
    seq: BigInt(id),
    projectId,
    componentId: null,
    resourceId: null,
    kind: 'deployment',
    severity: 'info',
    previousValue: null,
    currentValue: 'ready',
    detail: '배포 상태가 관측되었습니다.',
    notifiedAt: null,
    occurredAt,
  };
}

describe('TimelineList project context', () => {
  it('labels global, known, and deleted project events when names are supplied', () => {
    const markup = renderToStaticMarkup(createElement(TimelineList, {
      events: [
        event('1', null),
        event('2', 'project-known'),
        event('3', 'project-deleted'),
      ],
      renderedAt,
      projectNames: new Map([['project-known', 'DeployHub']]),
    }));

    expect(markup).toContain('전역');
    expect(markup).toContain('DeployHub');
    expect(markup).toContain('삭제된 프로젝트');
  });

  it('omits project context when names are not supplied', () => {
    const markup = renderToStaticMarkup(createElement(TimelineList, {
      events: [
        event('1', null),
        event('2', 'project-known'),
        event('3', 'project-deleted'),
      ],
      renderedAt,
    }));

    expect(markup).not.toContain('전역');
    expect(markup).not.toContain('DeployHub');
    expect(markup).not.toContain('삭제된 프로젝트');
  });
});
