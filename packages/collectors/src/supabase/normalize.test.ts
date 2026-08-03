import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeSupabaseProject } from './normalize';

afterEach(() => {
  vi.useRealTimers();
});

describe('normalizeSupabaseProject', () => {
  it('normalizes only non-secret project facts', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-04T00:00:00.000Z'));
    const resource = normalizeSupabaseProject({
      id: 42,
      ref: 'abcdefghijklmnopqrst',
      name: 'LinkVault',
      status: 'ACTIVE_HEALTHY',
      region: 'ap-northeast-2',
      organization_id: 'org_123',
      database: {
        host: 'db.abcdefghijklmnopqrst.supabase.co',
        version: '17.4.1.054',
        postgres_engine: '17',
        password: 'must-not-leak',
      },
      service_role_key: 'must-not-leak',
    });

    expect(resource).toEqual({
      provider: 'supabase',
      externalId: 'abcdefghijklmnopqrst',
      resourceType: 'supabase_project',
      name: 'LinkVault',
      status: 'ACTIVE_HEALTHY',
      region: 'ap-northeast-2',
      metadata: {
        organizationId: 'org_123',
        databaseHost: 'db.abcdefghijklmnopqrst.supabase.co',
        databaseVersion: '17.4.1.054',
        postgresEngine: '17',
      },
      observedAt: '2026-08-04T00:00:00.000Z',
    });
    expect(JSON.stringify(resource)).not.toContain('must-not-leak');
  });

  it('normalizes missing optional facts to safe null metadata', () => {
    const resource = normalizeSupabaseProject({
      ref: 'abcdefghijklmnopqrst',
      name: 'LinkVault',
    });

    expect(resource).not.toHaveProperty('status');
    expect(resource).not.toHaveProperty('region');
    expect(resource).not.toHaveProperty('url');
    expect(resource.metadata).toEqual({
      organizationId: null,
      databaseHost: null,
      databaseVersion: null,
      postgresEngine: null,
    });
  });

  it('rejects missing project ref or name', () => {
    expect(() => normalizeSupabaseProject({ name: 'LinkVault' }))
      .toThrow('Supabase 프로젝트 응답의 필수 필드가 없습니다.');
    expect(() => normalizeSupabaseProject({ ref: 'abcdefghijklmnopqrst' }))
      .toThrow('Supabase 프로젝트 응답의 필수 필드가 없습니다.');
  });
});
