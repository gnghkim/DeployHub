import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_TIME_ZONE = process.env.TZ;

afterEach(() => {
  if (ORIGINAL_TIME_ZONE === undefined) {
    delete process.env.TZ;
  } else {
    process.env.TZ = ORIGINAL_TIME_ZONE;
  }

  vi.resetModules();
});

describe.each(['UTC', 'America/Los_Angeles'])('formatDateTime in %s', (runtimeTimeZone) => {
  it('renders a known instant in the Seoul display timezone', async () => {
    process.env.TZ = runtimeTimeZone;
    vi.resetModules();

    const { DISPLAY_TIME_ZONE, formatDateTime } = await import('./datetime');

    expect(DISPLAY_TIME_ZONE).toBe('Asia/Seoul');
    expect(formatDateTime(new Date('2026-07-31T01:00:00Z'))).toBe(
      '2026. 7. 31. 10:00',
    );
  });

  it('renders midnight as 00:00 rather than 24:00', async () => {
    process.env.TZ = runtimeTimeZone;
    vi.resetModules();

    const { formatDateTime } = await import('./datetime');

    expect(formatDateTime(new Date('2026-07-30T15:00:00Z'))).toBe(
      '2026. 7. 31. 00:00',
    );
  });
});
