import {
  existsSync,
  readFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function source(relativePath: string): string {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

const page = source('./page.tsx');
const timeline = source('../../components/events/timeline-list.tsx');

describe('global events timeline', () => {
  it('is a dynamic server page backed by the global timeline query', () => {
    expect(page).not.toContain("'use client'");
    expect(page).toContain("export const dynamic = 'force-dynamic'");
    expect(page).toContain('listTimelineEvents(db, {');
    expect(page).toContain('projectId: null');
    expect(page).toContain('const renderedAt = new Date()');
    expect(page).toContain('<TimelineList');
  });

  it('uses compact mobile padding and the exact empty state', () => {
    expect(page).toContain('space-y-6 p-4 md:p-8');
    expect(timeline).toContain(
      "emptyMessage = '아직 기록된 변경이 없습니다'",
    );
    expect(timeline).toContain('{emptyMessage}');
    expect(page).not.toContain('Badge');
  });

  it('renders static server-relative and absolute times accessibly', () => {
    expect(timeline).not.toContain("'use client'");
    expect(timeline).toContain('formatRelativeTime(');
    expect(timeline).toContain('renderedAt');
    expect(timeline).toContain('<time');
    expect(timeline).toContain(
      'className="block font-mono text-xs text-[var(--annotation)] sm:mt-1"',
    );
    expect(timeline).toContain('dateTime={event.occurredAt.toISOString()}');
    expect(timeline).toContain('title={DATE_FORMAT.format(event.occurredAt)}');
  });

  it('shows transitions, marks first observations, and puts detail below', () => {
    expect(timeline).toContain("event.previousValue === null");
    expect(timeline).toContain('최초 관측');
    expect(timeline).toContain('{event.previousValue}');
    expect(timeline).toContain('→');
    expect(timeline).toContain('{event.currentValue}');
    expect(timeline).toContain('className="sr-only">에서</span>');
    expect(timeline).toContain(
      'className="sr-only">으로 변경</span>',
    );
    expect(timeline).toContain('{event.detail}');
    expect(timeline).toMatch(
      /event\.currentValue[\s\S]+mt-1 text-xs[\s\S]+event\.detail/,
    );
  });

  it('keeps info quiet and uses only existing warning and error tokens for elevated severities', () => {
    expect(timeline).toContain("info: 'text-[var(--annotation)]'");
    expect(timeline).toContain(
      "warning: 'text-[var(--caution)]'",
    );
    expect(timeline).toContain(
      "critical: 'text-[var(--fault)]'",
    );
    expect(timeline).not.toContain('--accent');
    expect(timeline).not.toMatch(/bg-\[var\(--(caution|fault)\)\]/);
  });
});
