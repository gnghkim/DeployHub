import { EventEmitter } from 'node:events';
import type {
  ConnectionOptions,
  PeerCertificate,
  TLSSocket,
} from 'node:tls';
import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { fetchCertificate } from './certificate';

const DAY_MS = 24 * 60 * 60 * 1_000;
const REFERENCE_TIME = new Date('2030-01-01T00:00:00.000Z');

class FakeTlsSocket extends EventEmitter {
  authorized = true;
  authorizationError: Error | null = null;
  certificate: Partial<PeerCertificate> = {
    valid_to: 'Jan 15 00:00:00 2030 GMT',
    issuer: { CN: 'Test CA' },
  };
  destroy = vi.fn(() => this);
  getPeerCertificate = vi.fn(
    () => this.certificate as PeerCertificate,
  );
}

function dependencies(socket: FakeTlsSocket): {
  connect: (options: ConnectionOptions) => TLSSocket;
  now: () => Date;
  connectSpy: ReturnType<typeof vi.fn>;
} {
  const connectSpy = vi.fn((options: ConnectionOptions) => {
    queueMicrotask(() => socket.emit('secureConnect'));
    return socket as unknown as TLSSocket;
  });
  return {
    connect: connectSpy,
    now: () => REFERENCE_TIME,
    connectSpy,
  };
}

describe('fetchCertificate', () => {
  it('uses TLS with SNI and returns validTo as ISO 8601', async () => {
    const socket = new FakeTlsSocket();
    const deps = dependencies(socket);

    const result = await fetchCertificate('example.com', 2_500, deps);

    expect(deps.connectSpy).toHaveBeenCalledWith({
      host: 'example.com',
      port: 443,
      servername: 'example.com',
      rejectUnauthorized: false,
      timeout: 2_500,
    });
    expect(result).toMatchObject({
      kind: 'ok',
      validTo: '2030-01-15T00:00:00.000Z',
    });
  });

  it('calculates daysRemaining from the caller-supplied reference time', async () => {
    const socket = new FakeTlsSocket();
    socket.certificate.valid_to = new Date(
      REFERENCE_TIME.getTime() + (10 * DAY_MS),
    ).toUTCString();

    const result = await fetchCertificate(
      'example.com',
      1_000,
      dependencies(socket),
    );

    expect(result).toMatchObject({ kind: 'ok', daysRemaining: 10 });
  });

  it('reports an empty peer certificate as no_certificate', async () => {
    const socket = new FakeTlsSocket();
    socket.certificate = {};

    await expect(fetchCertificate(
      'example.com',
      1_000,
      dependencies(socket),
    )).resolves.toEqual({
      kind: 'error',
      reason: 'no_certificate',
    });
  });

  it('reports the socket timeout event as timeout', async () => {
    const socket = new FakeTlsSocket();
    const connect = vi.fn(() => {
      queueMicrotask(() => socket.emit('timeout'));
      return socket as unknown as TLSSocket;
    });

    await expect(fetchCertificate(
      'example.com',
      1_000,
      { connect, now: () => REFERENCE_TIME },
    )).resolves.toEqual({
      kind: 'error',
      reason: 'timeout',
    });
  });

  it.each([
    ['error', new Error('handshake failed')],
    ['close', undefined],
  ] as const)(
    'reports %s before secureConnect as handshake',
    async (event, eventValue) => {
      const socket = new FakeTlsSocket();
      const connect = vi.fn(() => {
        queueMicrotask(() => socket.emit(event, eventValue));
        return socket as unknown as TLSSocket;
      });

      await expect(fetchCertificate(
        'example.com',
        1_000,
        { connect, now: () => REFERENCE_TIME },
      )).resolves.toEqual({
        kind: 'error',
        reason: 'handshake',
      });
    },
  );

  it('returns only the allow-listed result keys', async () => {
    const socket = new FakeTlsSocket();
    socket.certificate = {
      valid_to: 'Jan 15 00:00:00 2030 GMT',
      issuer: { CN: 'Test CA' },
      raw: Buffer.from('secret raw certificate'),
      pubkey: Buffer.from('secret public key'),
      subject: { CN: 'example.com' },
    };

    const result = await fetchCertificate(
      'example.com',
      1_000,
      dependencies(socket),
    );

    expect(Object.keys(result).sort()).toEqual([
      'daysRemaining',
      'issuer',
      'kind',
      'validTo',
      'verificationError',
      'verified',
    ]);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result).toMatchObject({ issuer: 'Test CA' });
  });

  it.each([
    {
      name: 'success',
      trigger: (socket: FakeTlsSocket) => socket.emit('secureConnect'),
    },
    {
      name: 'failure',
      trigger: (socket: FakeTlsSocket) => socket.emit(
        'error',
        new Error('handshake failed'),
      ),
    },
    {
      name: 'timeout',
      trigger: (socket: FakeTlsSocket) => socket.emit('timeout'),
    },
  ])('destroys the socket after $name', async ({ trigger }) => {
    const socket = new FakeTlsSocket();
    const connect = vi.fn(() => {
      queueMicrotask(() => trigger(socket));
      return socket as unknown as TLSSocket;
    });

    await fetchCertificate(
      'example.com',
      1_000,
      { connect, now: () => REFERENCE_TIME },
    );

    expect(socket.destroy).toHaveBeenCalledOnce();
  });

  it('reports authorized certificates as verified without an error', async () => {
    const socket = new FakeTlsSocket();
    socket.authorized = true;
    socket.authorizationError = null;

    const result = await fetchCertificate(
      'example.com',
      1_000,
      dependencies(socket),
    );

    expect(result).toMatchObject({
      kind: 'ok',
      verified: true,
      verificationError: null,
    });
  });

  it('keeps validTo while reporting an authorization error code', async () => {
    const socket = new FakeTlsSocket();
    socket.authorized = false;
    socket.authorizationError = Object.assign(
      new Error('self signed certificate'),
      { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' },
    );

    const result = await fetchCertificate(
      'example.com',
      1_000,
      dependencies(socket),
    );

    expect(result).toMatchObject({
      kind: 'ok',
      validTo: '2030-01-15T00:00:00.000Z',
      verified: false,
      verificationError: 'DEPTH_ZERO_SELF_SIGNED_CERT',
    });
  });

  it('falls back to UNKNOWN for an authorization error without a code', async () => {
    const socket = new FakeTlsSocket();
    socket.authorized = false;
    socket.authorizationError = new Error('certificate rejected');

    const result = await fetchCertificate(
      'example.com',
      1_000,
      dependencies(socket),
    );

    expect(result).toMatchObject({
      kind: 'ok',
      verified: false,
      verificationError: 'UNKNOWN',
    });
  });

  it('destroys the socket from the timeout handler', async () => {
    const socket = new FakeTlsSocket();
    const connect = vi.fn(() => {
      queueMicrotask(() => socket.emit('timeout'));
      return socket as unknown as TLSSocket;
    });

    await fetchCertificate(
      'example.com',
      1_000,
      { connect, now: () => REFERENCE_TIME },
    );

    expect(socket.destroy).toHaveBeenCalledOnce();
  });

  it('settles with timeout after an absolute deadline when the socket is silent', async () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeTlsSocket();
      const connect = vi.fn(
        () => socket as unknown as TLSSocket,
      );
      const settled = vi.fn();

      void fetchCertificate(
        'example.com',
        1_000,
        { connect, now: () => REFERENCE_TIME },
      ).then(settled);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(settled).toHaveBeenCalledOnce();
      expect(settled).toHaveBeenCalledWith({
        kind: 'error',
        reason: 'timeout',
      });
      expect(socket.destroy).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('settles once and ignores overlapping terminal events', async () => {
    const socket = new FakeTlsSocket();
    const connect = vi.fn(() => {
      queueMicrotask(() => {
        socket.emit('timeout');
        socket.emit('error', new Error('late error'));
        socket.emit('close');
        socket.emit('secureConnect');
      });
      return socket as unknown as TLSSocket;
    });

    const result = await Promise.race([
      fetchCertificate(
        'example.com',
        1_000,
        { connect, now: () => REFERENCE_TIME },
      ),
      new Promise<'hung'>((resolve) => {
        setTimeout(() => resolve('hung'), 100);
      }),
    ]);

    expect(result).toEqual({ kind: 'error', reason: 'timeout' });
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(socket.getPeerCertificate).not.toHaveBeenCalled();
  });
});
