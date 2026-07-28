import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import LegacyDraftDetailPage from '../drafts/[id]/page';
import LegacyDraftsPage from '../drafts/page';
import LegacyProvidersPage from '../providers/page';
import LegacyResourcesPage from '../resources/page';

const source = (relativePath: string) => readFileSync(
  fileURLToPath(new URL(relativePath, import.meta.url)),
  'utf8',
);

describe('settings routes', () => {
  it('keeps legacy top-level routes as server redirects', () => {
    expect(source('../resources/page.tsx')).toContain(
      "redirect('/settings/resources');",
    );
    expect(source('../providers/page.tsx')).toContain(
      "redirect('/settings/providers');",
    );
    expect(source('../drafts/page.tsx')).toContain(
      "redirect('/settings/drafts');",
    );
  });

  it('redirects legacy Draft detail links while preserving the id', () => {
    const detail = source('../drafts/[id]/page.tsx');

    expect(detail).toContain(
      "redirect(`/settings/drafts/${(await params).id}`);",
    );
  });

  it('executes the legacy redirects with their new destinations', async () => {
    for (const [page, destination] of [
      [LegacyResourcesPage, '/settings/resources'],
      [LegacyProvidersPage, '/settings/providers'],
      [LegacyDraftsPage, '/settings/drafts'],
    ] as const) {
      try {
        page();
        throw new Error('redirect did not execute');
      } catch (error) {
        expect((error as { digest?: string }).digest).toContain(destination);
      }
    }

    await expect(
      LegacyDraftDetailPage({
        params: Promise.resolve({ id: 'draft-123' }),
      }),
    ).rejects.toMatchObject({
      digest: expect.stringContaining('/settings/drafts/draft-123'),
    });
  });

  it('returns the new Draft detail URL from the registration API', () => {
    const route = source('../api/v1/project-drafts/route.ts');

    expect(route).toContain('url: `/settings/drafts/${draft.id}`');
    expect(route).not.toContain('url: `/drafts/${draft.id}`');
  });
});
