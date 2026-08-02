import { describe, expect, it, vi } from 'vitest';

import { SnapshotCaptureError } from './errors.js';
import {
  type AddressResolver,
  resolvePublicHttpUrl,
  validatePublicHttpUrl,
} from './url-policy.js';

const PUBLIC_V4 = '93.184.216.34';
const PUBLIC_V6 = '2606:2800:220:1:248:1893:25c8:1946';

function resolver(
  ipv4: readonly string[] = [PUBLIC_V4],
  ipv6: readonly string[] = [PUBLIC_V6],
): AddressResolver {
  return {
    resolve4: vi.fn(async () => [...ipv4]),
    resolve6: vi.fn(async () => [...ipv6]),
  };
}

async function expectBlocked(
  target: string,
  addressResolver = resolver(),
  redirectCount = 0,
) {
  await expect(
    validatePublicHttpUrl(target, addressResolver, redirectCount),
  ).rejects.toMatchObject({
    code: 'blocked_target',
    message: 'The capture target is not allowed.',
  } satisfies Partial<SnapshotCaptureError>);
}

describe('validatePublicHttpUrl', () => {
  it.each([
    ['http://example.com/path?q=1', 'http://example.com/path?q=1'],
    ['https://EXAMPLE.com', 'https://example.com/'],
    ['http://example.com:80', 'http://example.com/'],
    ['https://example.com:443', 'https://example.com/'],
  ])('accepts and normalizes public HTTP URLs', async (target, normalized) => {
    await expect(validatePublicHttpUrl(target, resolver())).resolves.toBe(normalized);
  });

  it.each([
    'ftp://example.com/',
    'file:///etc/passwd',
    'data:text/plain,hello',
    'https://user@example.com/',
    'https://user:secret@example.com/',
    'https://example.com:444/',
    'http://example.com:8080/',
    'not a URL',
  ])('rejects unsupported URL syntax or authority: %s', async (target) => {
    await expectBlocked(target);
  });

  it.each([
    'http://localhost/',
    'http://LOCALHOST./',
    'http://api.localhost/',
  ])('rejects localhost names: %s', async (target) => {
    await expectBlocked(target);
  });

  it.each([
    '0.0.0.0',
    '10.1.2.3',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.0.0.9',
    '192.0.2.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '240.0.0.1',
    '255.255.255.255',
    '168.63.129.16',
  ])('rejects non-public IPv4 literal %s', async (address) => {
    await expectBlocked(`http://${address}/`, resolver([], []));
  });

  it('accepts a public IPv4 literal without resolving DNS', async () => {
    const addressResolver = resolver([], []);

    await expect(
      validatePublicHttpUrl(`https://${PUBLIC_V4}/`, addressResolver),
    ).resolves.toBe(`https://${PUBLIC_V4}/`);
    expect(addressResolver.resolve4).not.toHaveBeenCalled();
    expect(addressResolver.resolve6).not.toHaveBeenCalled();
  });

  it.each([
    '::',
    '::1',
    '100::1',
    '2001:db8::1',
    '3fff::1',
    '2620:4f:8000::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'fec0::1',
    'ff02::1',
  ])('rejects non-public IPv6 literal %s', async (address) => {
    await expectBlocked(`http://[${address}]/`, resolver([], []));
  });

  it.each([
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '::ffff:0:0:7f00:1',
    '64:ff9b::127.0.0.1',
    '64:ff9b:1::808:808',
    '2001::1',
    '2002:5db8:d822::1',
    '2001:db8:0:1:0:5efe:5db8:d822',
  ])('conservatively rejects mapped, translated, or tunneled IPv6 %s', async (address) => {
    await expectBlocked(`http://[${address}]/`, resolver([], []));
  });

  it('accepts a public IPv6 literal without resolving DNS', async () => {
    const addressResolver = resolver([], []);

    await expect(
      validatePublicHttpUrl(`https://[${PUBLIC_V6}]/`, addressResolver),
    ).resolves.toBe(`https://[${PUBLIC_V6}]/`);
    expect(addressResolver.resolve4).not.toHaveBeenCalled();
    expect(addressResolver.resolve6).not.toHaveBeenCalled();
  });

  it('resolves both address families and requires every answer to be public', async () => {
    const addressResolver = resolver([PUBLIC_V4, '10.0.0.1'], [PUBLIC_V6]);

    await expectBlocked('https://example.com/', addressResolver);
    expect(addressResolver.resolve4).toHaveBeenCalledWith('example.com');
    expect(addressResolver.resolve6).toHaveBeenCalledWith('example.com');
  });

  it('returns the validated addresses for a connection-pinning caller', async () => {
    await expect(
      resolvePublicHttpUrl('https://example.com/', resolver([PUBLIC_V4], [PUBLIC_V6])),
    ).resolves.toEqual({
      url: 'https://example.com/',
      addresses: [
        { address: PUBLIC_V4, family: 4 },
        { address: PUBLIC_V6, family: 6 },
      ],
    });
  });

  it('rejects a hostname when neither address family resolves', async () => {
    await expectBlocked('https://example.com/', resolver([], []));
  });

  it('rejects resolver failures without exposing the upstream message', async () => {
    const addressResolver: AddressResolver = {
      resolve4: vi.fn(async () => {
        throw new Error('resolver details must stay private');
      }),
      resolve6: vi.fn(async () => []),
    };

    await expectBlocked('https://example.com/', addressResolver);
  });

  it('revalidates redirect destinations with fresh DNS answers', async () => {
    const addressResolver = resolver([PUBLIC_V4], []);

    await validatePublicHttpUrl('https://example.com/', addressResolver, 0);
    vi.mocked(addressResolver.resolve4).mockResolvedValueOnce(['10.0.0.1']);

    await expectBlocked('https://redirect.example/', addressResolver, 1);
    expect(addressResolver.resolve4).toHaveBeenCalledTimes(2);
  });

  it('allows five redirects and rejects a sixth', async () => {
    await expect(
      validatePublicHttpUrl('https://example.com/', resolver(), 5),
    ).resolves.toBe('https://example.com/');
    await expectBlocked('https://example.com/', resolver(), 6);
  });
});
