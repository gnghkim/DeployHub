import {
  connect as tlsConnect,
  type ConnectionOptions,
  type PeerCertificate,
  type TLSSocket,
} from 'node:tls';

const DAY_MS = 24 * 60 * 60 * 1_000;

export type CertificateResult =
  | {
    kind: 'ok';
    validTo: string;
    issuer: string;
    daysRemaining: number;
    verified: boolean;
    verificationError: string | null;
  }
  | {
    kind: 'error';
    reason: 'timeout' | 'handshake' | 'no_certificate';
  };

type CertificateDependencies = {
  connect?: (options: ConnectionOptions) => TLSSocket;
  now?: () => Date;
};

function issuerName(certificate: PeerCertificate): string {
  const issuer = certificate.issuer as unknown;
  if (typeof issuer !== 'object' || issuer === null) return '';

  const values = issuer as Record<string, unknown>;
  const value = values.O ?? values.CN;
  if (Array.isArray(value)) return value.join(', ');
  return typeof value === 'string' ? value : '';
}

function verificationError(socket: TLSSocket): string {
  const error = socket.authorizationError as unknown;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return 'UNKNOWN';
}

export function fetchCertificate(
  host: string,
  timeoutMs: number,
): Promise<CertificateResult>;
export function fetchCertificate(
  host: string,
  timeoutMs: number,
  dependencies: CertificateDependencies,
): Promise<CertificateResult>;
export function fetchCertificate(
  host: string,
  timeoutMs: number,
  dependencies: CertificateDependencies = {},
): Promise<CertificateResult> {
  const connect = dependencies.connect
    ?? ((options: ConnectionOptions) => tlsConnect(options));
  const now = dependencies.now ?? (() => new Date());

  return new Promise((resolve) => {
    let socket: TLSSocket;
    let settled = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: CertificateResult): void => {
      if (settled) return;
      settled = true;
      if (watchdog !== undefined) clearTimeout(watchdog);
      socket.destroy();
      resolve(result);
    };

    try {
      socket = connect({
        host,
        port: 443,
        servername: host,
        rejectUnauthorized: false,
        timeout: timeoutMs,
      });
    } catch {
      resolve({ kind: 'error', reason: 'handshake' });
      return;
    }

    socket.once('secureConnect', () => {
      if (settled) return;
      try {
        const certificate = socket.getPeerCertificate();
        if (
          Object.keys(certificate).length === 0
          || typeof certificate.valid_to !== 'string'
        ) {
          finish({ kind: 'error', reason: 'no_certificate' });
          return;
        }

        const validToDate = new Date(certificate.valid_to);
        if (Number.isNaN(validToDate.getTime())) {
          finish({ kind: 'error', reason: 'no_certificate' });
          return;
        }

        finish({
          kind: 'ok',
          validTo: validToDate.toISOString(),
          issuer: issuerName(certificate),
          daysRemaining: Math.ceil(
            (validToDate.getTime() - now().getTime()) / DAY_MS,
          ),
          verified: socket.authorized,
          verificationError: socket.authorized
            ? null
            : verificationError(socket),
        });
      } catch {
        finish({ kind: 'error', reason: 'handshake' });
      }
    });
    socket.on('timeout', () => {
      finish({ kind: 'error', reason: 'timeout' });
    });
    socket.on('error', () => {
      finish({ kind: 'error', reason: 'handshake' });
    });
    socket.on('close', () => {
      finish({ kind: 'error', reason: 'handshake' });
    });
    watchdog = setTimeout(() => {
      finish({ kind: 'error', reason: 'timeout' });
    }, timeoutMs);
  });
}
