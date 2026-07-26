import { describe, expect, it } from 'vitest';
import { createCli, isMainModule } from './index';

describe('createCli', () => {
  it('routes init --detect and --force to the init command', async () => {
    let received:
      | {
          rootDir: string;
          detect: boolean;
          force?: boolean;
        }
      | undefined;
    const cli = createCli({
      cwd: () => 'C:/project',
      output: () => undefined,
      init: async (options) => {
        received = options;
      },
      validate: async () => 0,
      setExitCode: () => undefined,
    });

    await cli.parseAsync([
      'node',
      'deployhub',
      'init',
      '--detect',
      '--force',
    ]);

    expect(received).toMatchObject({
      rootDir: 'C:/project',
      detect: true,
      force: true,
    });
  });

  it('routes validate --remote and propagates its exit code', async () => {
    let received:
      | {
          rootDir: string;
          baseUrl: string;
          remote: boolean;
        }
      | undefined;
    let exitCode: number | undefined;
    const cli = createCli({
      cwd: () => 'C:/project',
      output: () => undefined,
      init: async () => undefined,
      validate: async (options) => {
        received = options;
        return 1;
      },
      setExitCode: (code) => {
        exitCode = code;
      },
    });

    await cli.parseAsync([
      'node',
      'deployhub',
      'validate',
      '--remote',
      '--base-url',
      'https://hub.example',
    ]);

    expect(received).toEqual({
      rootDir: 'C:/project',
      baseUrl: 'https://hub.example',
      remote: true,
      output: expect.any(Function),
    });
    expect(exitCode).toBe(1);
  });
});

describe('isMainModule', () => {
  it('recognizes an entrypoint reached through a package-manager link', () => {
    const canonicalize = (path: string) =>
      path === 'C:\\linked\\deployhub.js'
        ? 'C:\\real\\dist\\index.js'
        : path;

    expect(
      isMainModule(
        'C:\\linked\\deployhub.js',
        'file:///C:/real/dist/index.js',
        canonicalize,
      ),
    ).toBe(true);
  });
});
