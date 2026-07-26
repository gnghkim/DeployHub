import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runDiff } from './diff';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function projectManifest(): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), 'deployhub-diff-'));
  temporaryDirectories.push(rootDir);
  await writeFile(
    join(rootDir, 'deployhub.yaml'),
    `apiVersion: deployhub.io/v1
kind: Project
metadata:
  name: Example
  slug: example
  description: New description
spec:
  lifecycle: production
  importance: 4
  components:
    - name: web
      type: frontend
      criticality: 4
`,
  );
  return rootDir;
}

describe('runDiff', () => {
  it('compares the local manifest with the server declaration', async () => {
    const token = 'dh_reg_diff-token';
    const output: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        project: {
          name: 'Example',
          slug: 'example',
          description: 'Old description',
          lifecycle: 'production',
          importance: 4,
          owner: null,
          repository: null,
          components: [
            {
              name: 'web',
              componentType: 'frontend',
              framework: null,
              runtime: null,
              language: null,
              criticality: 4,
            },
          ],
          domains: [],
        },
      }),
    );

    const exitCode = await runDiff({
      rootDir: await projectManifest(),
      baseUrl: 'https://hub.example',
      token,
      output: (line) => output.push(line),
      fetchImpl,
    });

    expect(exitCode).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hub.example/api/v1/projects/example/manifest',
      expect.objectContaining({
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      }),
    );
    expect(output.join('\n')).toContain(
      'description: Old description -> New description',
    );
    expect(output.join('\n')).not.toContain(token);
  });

  it('fails before a server request when DEPLOYHUB_TOKEN is missing', async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(runDiff({
      rootDir: await projectManifest(),
      baseUrl: 'https://hub.example',
      token: '',
      output: () => undefined,
      fetchImpl,
    })).rejects.toThrow('DEPLOYHUB_TOKEN environment variable is required');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sanitizes read transport errors that contain the token', async () => {
    const token = 'dh_reg_IDENTIFIABLE_DIFF_SECRET';
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error(`request failed with ${token}`));

    let message = '';
    try {
      await runDiff({
        rootDir: await projectManifest(),
        baseUrl: 'https://hub.example',
        token,
        output: () => undefined,
        fetchImpl,
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe('Unable to reach the DeployHub project lookup endpoint');
    expect(message).not.toContain(token);
  });
});
