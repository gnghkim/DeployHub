import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const middlewareSource = readFileSync(
  new URL('./middleware.ts', import.meta.url),
  'utf8',
);
const matcher = middlewareSource.match(/matcher:\s*\[\s*'([^']+)'/)?.[1];
if (!matcher) {
  throw new Error('Unable to read middleware matcher');
}

const isAuthenticatedPath = (pathname: string): boolean =>
  new RegExp(`^${matcher}$`).test(pathname);

describe('middleware matcher', () => {
  it('leaves only the manifest endpoints and Draft submission unauthenticated', () => {
    for (const pathname of [
      '/schemas/deployhub-v1.json',
      '/api/v1/manifest/schema',
      '/api/v1/manifest/template',
      '/api/v1/manifest/validate',
      '/api/v1/project-drafts',
    ]) {
      expect(isAuthenticatedPath(pathname), pathname).toBe(false);
    }
  });

  it('still authenticates adjacent paths with similar prefixes', () => {
    for (const pathname of [
      '/schemas-private',
      '/schemas/deployhub-v1.json-private',
      '/api/v1/manifest-admin',
      '/api/v1/manifest/schema-private',
      '/api/v1/project-drafts-private',
      '/api/v1/project-drafts/draft-id',
    ]) {
      expect(isAuthenticatedPath(pathname), pathname).toBe(true);
    }
  });
});
