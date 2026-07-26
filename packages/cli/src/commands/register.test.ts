import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runRegister } from './register';

const temporaryDirectories: string[] = [];
const validManifest = `apiVersion: deployhub.io/v1
kind: Project
metadata:
  name: Example
  slug: example
spec:
  lifecycle: production
  components:
    - name: web
      type: frontend
`;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function projectWithManifest(contents = validManifest): Promise<string> {
  const rootDir = await mkdtemp(join(tmpdir(), 'deployhub-register-'));
  temporaryDirectories.push(rootDir);
  await writeFile(join(rootDir, 'deployhub.yaml'), contents);
  return rootDir;
}

describe('runRegister', () => {
  it('submits a locally valid manifest and prints the Draft URL', async () => {
    const rootDir = await projectWithManifest();
    const output: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          id: 'draft-1',
          status: 'pending_review',
          url: '/drafts/draft-1',
        },
        { status: 201 },
      ),
    );

    const exitCode = await runRegister({
      rootDir,
      baseUrl: 'https://hub.example',
      token: 'dh_reg_submit-token',
      output: (line) => output.push(line),
      fetchImpl,
      validate: async () => 0,
      detector: async () => ({
        manifest: {},
        fieldSources: { web: { type: { origin: 'detected' } } },
        notes: [],
      }),
    });

    expect(exitCode).toBe(0);
    expect(output).toContain(
      'Draft submitted: https://hub.example/drafts/draft-1',
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hub.example/api/v1/project-drafts',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer dh_reg_submit-token',
        }),
      }),
    );
  });

  it('does not make any server request for an invalid local manifest', async () => {
    const rootDir = await projectWithManifest(
      validManifest.replace('kind: Project', 'kind: Service'),
    );
    const fetchImpl = vi.fn<typeof fetch>();

    const exitCode = await runRegister({
      rootDir,
      baseUrl: 'https://hub.example',
      token: 'dh_reg_unused-token',
      output: () => undefined,
      fetchImpl,
    });

    expect(exitCode).toBe(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never includes the token in output or submission errors', async () => {
    const token = 'dh_reg_IDENTIFIABLE_SECRET_7fda';
    const rootDir = await projectWithManifest();
    const output: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(`failure for ${token}`, { status: 500 }),
    );

    let errorMessage = '';
    try {
      await runRegister({
        rootDir,
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
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect(`${output.join('\n')}\n${errorMessage}`).not.toContain(token);
    expect(errorMessage).toBe(
      'DeployHub Draft submission failed with HTTP 500',
    );
  });

  it('sanitizes transport errors that contain the token', async () => {
    const token = 'dh_reg_IDENTIFIABLE_TRANSPORT_SECRET_3eb4';
    const rootDir = await projectWithManifest();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error(`request failed with ${token}`));

    await expect(
      runRegister({
        rootDir,
        baseUrl: 'https://hub.example',
        token,
        output: () => undefined,
        fetchImpl,
        validate: async () => 0,
        detector: async () => ({
          manifest: {},
          fieldSources: {},
          notes: [],
        }),
      }),
    ).rejects.toThrow(
      'Unable to reach the DeployHub Draft submission endpoint',
    );
  });
});
