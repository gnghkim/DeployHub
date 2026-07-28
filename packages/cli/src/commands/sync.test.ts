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
              url: '/settings/drafts/draft-2',
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
    const token = 'dh_reg_sync-token';

    const exitCode = await runSync({
      rootDir: await projectManifest(),
      baseUrl: 'https://hub.example',
      token,
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
    const read = requests.find(({ init }) => init?.method !== 'POST');
    expect(read?.init).toMatchObject({
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
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
      'Draft submitted: https://hub.example/settings/drafts/draft-2',
    );
    expect(output.join('\n')).not.toContain(token);
  });

  it('fails before a server request when DEPLOYHUB_TOKEN is missing', async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(runSync({
      rootDir: await projectManifest(),
      baseUrl: 'https://hub.example',
      token: '',
      output: () => undefined,
      fetchImpl,
    })).rejects.toThrow('DEPLOYHUB_TOKEN environment variable is required');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sanitizes current-project errors that contain the token', async () => {
    const token = 'dh_reg_IDENTIFIABLE_SYNC_SECRET';
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error(`request failed with ${token}`));

    let message = '';
    try {
      await runSync({
        rootDir: await projectManifest(),
        baseUrl: 'https://hub.example',
        token,
        output: () => undefined,
        fetchImpl,
        validate: async () => 0,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe('Unable to reach the DeployHub project lookup endpoint');
    expect(message).not.toContain(token);
  });
});
