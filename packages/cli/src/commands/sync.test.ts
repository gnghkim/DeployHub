import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSync } from './sync';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function projectManifest(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), 'deployhub-sync-'));
  temporaryDirectories.push(rootDir);
  await writeFile(
    join(rootDir, 'deployhub.yaml'),
    `apiVersion: deployhub.io/v1
kind: Project
metadata:
  name: Example
  slug: example
spec:
  lifecycle: production
  components:
    - name: web
      type: frontend
`,
  );
  return rootDir;
}

describe('runSync', () => {
  it('submits a Draft with the current-project diff', async () => {
    const requests: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = vi.fn<typeof fetch>(
      async (input, init) => {
        const url = String(input);
        requests.push({ url, init });
        if (init?.method === 'POST') {
          return Response.json(
            {
              id: 'draft-2',
              status: 'pending_review',
              url: '/drafts/draft-2',
            },
            { status: 201 },
          );
        }
        return Response.json({
          project: {
            name: 'Example',
            slug: 'example',
            description: null,
            lifecycle: 'development',
            importance: 3,
            owner: null,
            repository: null,
            components: [],
            domains: [],
          },
        });
      },
    );
    const output: string[] = [];

    const exitCode = await runSync({
      rootDir: await projectManifest(),
      baseUrl: 'https://hub.example',
      token: 'dh_reg_sync-token',
      output: (line) => output.push(line),
      fetchImpl,
      validate: async () => 0,
      detector: async () => ({
        manifest: {},
        fieldSources: {},
        notes: [],
      }),
    });

    expect(exitCode).toBe(0);
    const submitted = requests.find(({ init }) => init?.method === 'POST');
    expect(JSON.parse(String(submitted?.init?.body))).toMatchObject({
      diff: {
        componentsAdded: ['web'],
        project: [
          { field: 'lifecycle', from: 'development', to: 'production' },
        ],
      },
    });
    expect(output).toContain(
      'Draft submitted: https://hub.example/drafts/draft-2',
    );
  });
});
