import { describe, expect, it } from 'vitest';
import {
  describeMissingObservation,
  type ObservationContext,
} from './observation-state';

const component = {
  provider: 'supabase',
  externalRef: 'abcdefghijklmnopqrst',
  containerName: null,
  updatedAt: new Date('2026-08-04T00:00:00.000Z'),
};

function context(
  overrides: Partial<ObservationContext> = {},
): ObservationContext {
  return {
    accounts: [],
    activeJobs: [],
    dockerLastSyncAt: null,
    ...overrides,
  };
}

describe('describeMissingObservation', () => {
  it('requires a connection when no provider account exists', () => {
    expect(describeMissingObservation(component, context())).toEqual({
      label: '연결 필요',
      detail: null,
    });
  });

  it('shows pending while a matching account job is active', () => {
    expect(describeMissingObservation(component, context({
      accounts: [{
        id: 'account-1',
        provider: 'supabase',
        lastSyncAt: null,
        lastError: null,
      }],
      activeJobs: [{
        type: 'supabase.sync',
        payload: { accountId: 'account-1' },
      }],
    }))).toEqual({ label: '동기화 대기', detail: null });
  });

  it('shows unobserved only after a sync newer than the declaration', () => {
    expect(describeMissingObservation(component, context({
      accounts: [{
        id: 'account-1',
        provider: 'supabase',
        lastSyncAt: new Date('2026-08-04T00:01:00.000Z'),
        lastError: null,
      }],
    }))).toEqual({ label: '관측되지 않음', detail: null });
  });

  it('requires another sync when the last success predates the declaration', () => {
    expect(describeMissingObservation(component, context({
      accounts: [{
        id: 'account-1',
        provider: 'supabase',
        lastSyncAt: new Date('2026-08-03T23:59:00.000Z'),
        lastError: null,
      }],
    }))).toEqual({ label: '동기화 필요', detail: null });
  });

  it('shows a safe provider error with sync required', () => {
    const error = 'Supabase 동기화에 실패했습니다. (HTTP 401)';
    expect(describeMissingObservation(component, context({
      accounts: [{
        id: 'account-1',
        provider: 'supabase',
        lastSyncAt: null,
        lastError: error,
      }],
    }))).toEqual({ label: '동기화 필요', detail: error });
  });

  it('uses only the matching Vercel account job', () => {
    expect(describeMissingObservation({
      ...component,
      provider: 'vercel',
    }, context({
      accounts: [{
        id: 'vercel-1',
        provider: 'vercel',
        lastSyncAt: null,
        lastError: null,
      }],
      activeJobs: [
        { type: 'vercel.sync', payload: { accountId: 'other' } },
        { type: 'vercel.sync', payload: { accountId: 'vercel-1' } },
      ],
    }))).toEqual({ label: '동기화 대기', detail: null });
  });

  it('derives Docker states from the global job and latest success', () => {
    const dockerComponent = {
      ...component,
      provider: 'hostinger',
      containerName: 'linkvault-worker',
    };

    expect(describeMissingObservation(dockerComponent, context({
      activeJobs: [{ type: 'docker.sync', payload: {} }],
    }))).toEqual({ label: '동기화 대기', detail: null });
    expect(describeMissingObservation(dockerComponent, context({
      dockerLastSyncAt: new Date('2026-08-04T00:01:00.000Z'),
    }))).toEqual({ label: '관측되지 않음', detail: null });
    expect(describeMissingObservation(dockerComponent, context())).toEqual({
      label: '동기화 필요',
      detail: null,
    });
  });
});
