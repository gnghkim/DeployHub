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
  it('leaves only the public API endpoints unauthenticated', () => {
    for (const pathname of [
      '/schemas/deployhub-v1.json',
      '/api/v1/manifest/schema',
      '/api/v1/manifest/template',
      '/api/v1/manifest/validate',
      '/api/v1/project-drafts',
      '/api/v1/projects/deployhub/manifest',
      '/api/v1/projects/deployhub/status',
      '/api/v1/projects/slug-with-dashes/manifest/',
      '/api/v1/projects/slug-with-dashes/status/',
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
      '/api/v1/projects',
      '/api/v1/projects/deployhub',
      '/api/v1/projects/deployhub/manifest-private',
      '/api/v1/projects/deployhub/status/private',
    ]) {
      expect(isAuthenticatedPath(pathname), pathname).toBe(true);
    }
  });
});
