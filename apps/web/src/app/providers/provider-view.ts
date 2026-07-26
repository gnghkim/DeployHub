import { decrypt } from '@deployhub/shared';

export function storedTokenSuffix(
  encryptedToken: string,
  encryptionKey: Buffer,
): string {
  return decrypt(encryptedToken, encryptionKey).slice(-4);
}
