import { Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';

import { SnapshotCaptureError } from './errors.js';

export interface AddressResolver {
  resolve4(hostname: string): Promise<readonly string[]>;
  resolve6(hostname: string): Promise<readonly string[]>;
}

const defaultResolver: AddressResolver = new Resolver();

type Ipv4Range = readonly [network: number, prefixLength: number];

function ipv4Number(address: string): number | undefined {
  const parts = address.split('.');
  if (parts.length !== 4) return undefined;

  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function ipv4Range(network: string, prefixLength: number): Ipv4Range {
  const value = ipv4Number(network);
  if (value === undefined) throw new Error('Invalid static IPv4 policy range.');
  return [value, prefixLength];
}

const BLOCKED_IPV4_RANGES: readonly Ipv4Range[] = [
  ipv4Range('0.0.0.0', 8),
  ipv4Range('10.0.0.0', 8),
  ipv4Range('100.64.0.0', 10),
  ipv4Range('127.0.0.0', 8),
  ipv4Range('169.254.0.0', 16),
  ipv4Range('172.16.0.0', 12),
  ipv4Range('192.0.0.0', 24),
  ipv4Range('192.0.2.0', 24),
  ipv4Range('192.31.196.0', 24),
  ipv4Range('192.52.193.0', 24),
  ipv4Range('192.88.99.0', 24),
  ipv4Range('192.168.0.0', 16),
  ipv4Range('192.175.48.0', 24),
  ipv4Range('198.18.0.0', 15),
  ipv4Range('198.51.100.0', 24),
  ipv4Range('203.0.113.0', 24),
  ipv4Range('224.0.0.0', 4),
  ipv4Range('240.0.0.0', 4),
  // Azure's platform virtual IP exposes instance metadata and host services.
  ipv4Range('168.63.129.16', 32),
];

function ipv4MatchesRange(value: number, [network, prefixLength]: Ipv4Range) {
  if (prefixLength === 0) return true;
  const mask = (0xffff_ffff << (32 - prefixLength)) >>> 0;
  return (value & mask) >>> 0 === (network & mask) >>> 0;
}

function isPublicIpv4(address: string) {
  const value = ipv4Number(address);
  return (
    value !== undefined &&
    !BLOCKED_IPV4_RANGES.some((range) => ipv4MatchesRange(value, range))
  );
}

function parseIpv6(address: string): Uint8Array | undefined {
  let input = address.toLowerCase();
  const zoneIndex = input.indexOf('%');
  if (zoneIndex !== -1) return undefined;

  const ipv4TailMatch = input.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4TailMatch?.[1]) {
    const ipv4 = ipv4Number(ipv4TailMatch[1]);
    if (ipv4 === undefined) return undefined;
    const high = ((ipv4 >>> 16) & 0xffff).toString(16);
    const low = (ipv4 & 0xffff).toString(16);
    input = `${input.slice(0, -ipv4TailMatch[1].length)}${high}:${low}`;
  }

  const doubleColon = input.indexOf('::');
  if (doubleColon !== -1 && input.indexOf('::', doubleColon + 1) !== -1) {
    return undefined;
  }

  const left = doubleColon === -1 ? input.split(':') : input.slice(0, doubleColon).split(':');
  const right = doubleColon === -1 ? [] : input.slice(doubleColon + 2).split(':');
  const cleanLeft = left.filter(Boolean);
  const cleanRight = right.filter(Boolean);
  const missing = 8 - cleanLeft.length - cleanRight.length;
  if (missing < (doubleColon === -1 ? 0 : 1)) return undefined;

  const groups =
    doubleColon === -1
      ? cleanLeft
      : [...cleanLeft, ...Array<string>(missing).fill('0'), ...cleanRight];
  if (groups.length !== 8 || groups.some((group) => !/^[\da-f]{1,4}$/.test(group))) {
    return undefined;
  }

  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    const value = Number.parseInt(group, 16);
    bytes[index * 2] = value >>> 8;
    bytes[index * 2 + 1] = value & 0xff;
  });
  return bytes;
}

function prefixMatches(address: Uint8Array, prefix: Uint8Array, prefixLength: number) {
  const wholeBytes = Math.floor(prefixLength / 8);
  for (let index = 0; index < wholeBytes; index += 1) {
    if (address[index] !== prefix[index]) return false;
  }

  const remainingBits = prefixLength % 8;
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return ((address[wholeBytes] ?? 0) & mask) === ((prefix[wholeBytes] ?? 0) & mask);
}

interface Ipv6Range {
  prefix: Uint8Array;
  prefixLength: number;
}

function ipv6Range(network: string, prefixLength: number): Ipv6Range {
  const prefix = parseIpv6(network);
  if (!prefix) throw new Error('Invalid static IPv6 policy range.');
  return { prefix, prefixLength };
}

const BLOCKED_IPV6_RANGES: readonly Ipv6Range[] = [
  ipv6Range('::', 96), // Unspecified, loopback, and deprecated IPv4-compatible forms.
  ipv6Range('::ffff:0:0', 96), // IPv4-mapped forms.
  ipv6Range('64:ff9b::', 96), // Well-known NAT64 translation prefix.
  ipv6Range('64:ff9b:1::', 48), // Local-use NAT64 translation prefix.
  ipv6Range('100::', 64), // Discard-only.
  ipv6Range('2001::', 23), // IETF special-purpose assignments, including Teredo.
  ipv6Range('2001:db8::', 32), // Documentation.
  ipv6Range('2002::', 16), // 6to4 tunnel encoding.
  ipv6Range('3fff::', 20), // Documentation.
  ipv6Range('5f00::', 16), // Segment-routing SIDs.
  ipv6Range('2620:4f:8000::', 48), // Direct-delegation AS112 service.
  ipv6Range('fc00::', 7), // Unique local.
  ipv6Range('fe80::', 10), // Link local.
  ipv6Range('fec0::', 10), // Deprecated site local.
  ipv6Range('ff00::', 8), // Multicast.
];

const PUBLIC_IPV6_UNICAST = ipv6Range('2000::', 3);

function isIsatapEncoding(bytes: Uint8Array) {
  return (
    (bytes[8] === 0x00 || bytes[8] === 0x02) &&
    bytes[9] === 0x00 &&
    bytes[10] === 0x5e &&
    bytes[11] === 0xfe
  );
}

function isPublicIpv6(address: string) {
  const bytes = parseIpv6(address);
  return (
    bytes !== undefined &&
    prefixMatches(
      bytes,
      PUBLIC_IPV6_UNICAST.prefix,
      PUBLIC_IPV6_UNICAST.prefixLength,
    ) &&
    !BLOCKED_IPV6_RANGES.some(({ prefix, prefixLength }) =>
      prefixMatches(bytes, prefix, prefixLength),
    ) &&
    !isIsatapEncoding(bytes)
  );
}

function isPublicAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family === 6) return isPublicIpv6(address);
  return false;
}

function isNoAddressError(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return error.code === 'ENODATA' || error.code === 'ENOTFOUND';
}

async function resolveFamily(resolve: () => Promise<readonly string[]>) {
  try {
    return await resolve();
  } catch (error) {
    if (isNoAddressError(error)) return [];
    throw new SnapshotCaptureError('blocked_target');
  }
}

function blocked(): never {
  throw new SnapshotCaptureError('blocked_target');
}

export interface ValidatedAddress {
  address: string;
  family: 4 | 6;
}

export interface ResolvedPublicHttpUrl {
  url: string;
  addresses: readonly ValidatedAddress[];
}

export async function resolvePublicHttpUrl(
  target: string,
  resolver: AddressResolver = defaultResolver,
  redirectCount = 0,
): Promise<ResolvedPublicHttpUrl> {
  if (!Number.isInteger(redirectCount) || redirectCount < 0 || redirectCount > 5) {
    blocked();
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    blocked();
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    (parsed.port !== '' && parsed.port !== '80' && parsed.port !== '443')
  ) {
    blocked();
  }

  const rawHostname = parsed.hostname;
  const unbracketedHostname =
    rawHostname.startsWith('[') && rawHostname.endsWith(']')
      ? rawHostname.slice(1, -1)
      : rawHostname;
  const hostname = unbracketedHostname.toLowerCase().replace(/\.$/, '');
  if (hostname === '' || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    blocked();
  }

  const family = isIP(hostname);
  let validatedAddresses: ValidatedAddress[];
  if (family === 4 || family === 6) {
    if (!isPublicAddress(hostname)) blocked();
    validatedAddresses = [{ address: hostname, family }];
  } else {
    const [ipv4, ipv6] = await Promise.all([
      resolveFamily(() => resolver.resolve4(hostname)),
      resolveFamily(() => resolver.resolve6(hostname)),
    ]);
    const addresses = [...ipv4, ...ipv6];
    if (addresses.length === 0 || !addresses.every(isPublicAddress)) blocked();
    validatedAddresses = addresses.map((address) => {
      const resolvedFamily = isIP(address);
      if (resolvedFamily !== 4 && resolvedFamily !== 6) blocked();
      return { address, family: resolvedFamily };
    });
    if (rawHostname !== hostname) parsed.hostname = hostname;
  }

  return { url: parsed.toString(), addresses: validatedAddresses };
}

export async function validatePublicHttpUrl(
  target: string,
  resolver: AddressResolver = defaultResolver,
  redirectCount = 0,
): Promise<string> {
  return (await resolvePublicHttpUrl(target, resolver, redirectCount)).url;
}
