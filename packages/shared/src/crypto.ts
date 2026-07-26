import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

export function loadEncryptionKey(raw: string | undefined): Buffer {
  if (raw === undefined || raw.trim() === '') {
    throw new Error('환경변수 ENCRYPTION_KEY가 설정되지 않았습니다.');
  }

  const encoded = raw.trim();
  const key = Buffer.from(encoded, 'base64');
  if (key.toString('base64') !== encoded) {
    throw new Error('ENCRYPTION_KEY는 올바른 base64 문자열이어야 합니다.');
  }
  if (key.length !== KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY는 base64로 인코딩된 32바이트여야 합니다. 현재 ${key.length}바이트입니다.`,
    );
  }
  return key;
}

export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    data.toString('base64'),
  ].join('.');
}

export function decrypt(payload: string, key: Buffer): string {
  const parts = payload.split('.');
  if (parts.length !== 3) {
    throw new Error('암호문 형식이 올바르지 않습니다.');
  }

  const [ivB64, tagB64, dataB64] = parts as [string, string, string];
  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
