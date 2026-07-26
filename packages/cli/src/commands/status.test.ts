import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runStatus } from './status';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('runStatus', () => {
  it('prints registration and connection status for the local project', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'deployhub-status-'));
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
    const token = 'dh_reg_status-token';
    const output: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        registered: true,
        slug: 'example',
        name: 'Example',
        status: 'active',
        lifecycle: 'production',
        componentCount: 1,
        linkedResourceCount: 2,
        latestDraft: {
          id: 'draft-1',
          status: 'pending_review',
          createdAt: '2026-07-26T02:00:00.000Z',
        },
        projectUrl: '/projects/example',
      }),
    );

    const exitCode = await runStatus({
      rootDir,
      baseUrl: 'https://hub.example',
      token,
      output: (line) => output.push(line),
      fetchImpl,
    });

    expect(exitCode).toBe(0);
    expect(output).toEqual([
      'Registration: registered',
      'Project: Example (active)',
      'Lifecycle: production',
      'Components: 1',
      'Linked resources: 2',
      'Latest Draft: pending_review',
      'Draft URL: https://hub.example/drafts/draft-1',
      'URL: https://hub.example/projects/example',
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://hub.example/api/v1/projects/example/status',
      expect.objectContaining({
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
      }),
    );
    expect(output.join('\n')).not.toContain(token);
  });

  it('fails before a server request when DEPLOYHUB_TOKEN is missing', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'deployhub-status-'));
    temporaryDirectories.push(rootDir);
    const fetchImpl = vi.fn<typeof fetch>();

    await expect(runStatus({
      rootDir,
      baseUrl: 'https://hub.example',
      token: '',
      output: () => undefined,
      fetchImpl,
    })).rejects.toThrow('DEPLOYHUB_TOKEN environment variable is required');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('prints a friendly result when the project is not registered', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'deployhub-status-'));
    temporaryDirectories.push(rootDir);
    await writeFile(
      join(rootDir, 'deployhub.yaml'),
      `apiVersion: deployhub.io/v1
kind: Project
metadata:
  name: Missing
  slug: missing
spec:
  lifecycle: development
  components:
    - name: web
      type: frontend
`,
    );
    const output: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ error: 'Not found' }, { status: 404 }),
    );

    const exitCode = await runStatus({
      rootDir,
      baseUrl: 'https://hub.example',
      token: 'dh_reg_status-token',
      output: (line) => output.push(line),
      fetchImpl,
    });

    expect(exitCode).toBe(0);
    expect(output).toEqual(['Registration: not registered']);
  });
});
