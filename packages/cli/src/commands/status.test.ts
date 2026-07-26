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
    const output: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        registered: true,
        projectStatus: 'active',
        connectionStatus: 'connected',
        projectUrl: '/projects/example',
      }),
    );

    const exitCode = await runStatus({
      rootDir,
      baseUrl: 'https://hub.example',
      output: (line) => output.push(line),
      fetchImpl,
    });

    expect(exitCode).toBe(0);
    expect(output).toEqual([
      'Registration: registered',
      'Project: active',
      'Connection: connected',
      'URL: https://hub.example/projects/example',
    ]);
  });
});
