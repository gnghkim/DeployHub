import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, loadEncryptionKey } from './crypto';

const key = randomBytes(32);

describe('loadEncryptionKey', () => {
  it('base64 32바이트를 받아들인다', () => {
    expect(loadEncryptionKey(key.toString('base64')).length).toBe(32);
  });

  it('값이 없으면 변수명을 포함해 실패한다', () => {
    expect(() => loadEncryptionKey(undefined)).toThrow(/ENCRYPTION_KEY/);
  });

  it('길이가 32바이트가 아니면 실패한다', () => {
    expect(() => loadEncryptionKey(randomBytes(16).toString('base64'))).toThrow(/32/);
  });

  it('base64가 아닌 값이면 실패한다', () => {
    expect(() => loadEncryptionKey('!'.repeat(44))).toThrow(/base64/);
  });
});

describe('encrypt / decrypt', () => {
  it('왕복이 원문을 보존한다', () => {
    const secret = 'ghp_exampleToken1234567890';
    expect(decrypt(encrypt(secret, key), key)).toBe(secret);
  });

  it('같은 평문도 매번 다른 암호문이 된다', () => {
    expect(encrypt('same', key)).not.toBe(encrypt('same', key));
  });

  it('암호문에 평문이 남지 않는다', () => {
    const secret = 'ghp_exampleToken1234567890';
    expect(encrypt(secret, key)).not.toContain(secret);
  });

  it('다른 키로는 복호화되지 않는다', () => {
    expect(() => decrypt(encrypt('x', key), randomBytes(32))).toThrow();
  });

  it('본문이 변조되면 실패한다', () => {
    const [iv, tag, data] = encrypt('x', key).split('.');
    const tampered = Buffer.from(data!, 'base64');
    tampered[0] = tampered[0]! ^ 0xff;
    expect(() => decrypt(`${iv}.${tag}.${tampered.toString('base64')}`, key)).toThrow();
  });

  it('인증 태그가 변조되면 실패한다', () => {
    const [iv, tag, data] = encrypt('x', key).split('.');
    const tampered = Buffer.from(tag!, 'base64');
    tampered[0] = tampered[0]! ^ 0xff;
    expect(() =>
      decrypt(`${iv}.${tampered.toString('base64')}.${data}`, key),
    ).toThrow();
  });

  it('형식이 어긋나면 실패한다', () => {
    expect(() => decrypt('notavalidpayload', key)).toThrow();
  });
});
