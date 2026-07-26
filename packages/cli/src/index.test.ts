import { describe, expect, it } from 'vitest';
import { createCli, isMainModule } from './index';

describe('createCli', () => {
  const commandDependencies = {
    register: async () => 0,
    diff: async () => 0,
    sync: async () => 0,
    status: async () => 0,
  };

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
      ...commandDependencies,
      getenv: (name) =>
        name === 'DEPLOYHUB_URL' ? 'https://hub.example' : undefined,
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

  it('routes validate --remote using DEPLOYHUB_URL and propagates its exit code', async () => {
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
      ...commandDependencies,
      getenv: (name) =>
        name === 'DEPLOYHUB_URL' ? 'https://hub.example' : undefined,
      setExitCode: (code) => {
        exitCode = code;
      },
    });

    await cli.parseAsync([
      'node',
      'deployhub',
      'validate',
      '--remote',
    ]);

    expect(received).toEqual({
      rootDir: 'C:/project',
      baseUrl: 'https://hub.example',
      remote: true,
      output: expect.any(Function),
    });
    expect(exitCode).toBe(1);
  });

  it('reads the registration token only from DEPLOYHUB_TOKEN', async () => {
    let received:
      | { baseUrl: string; token: string; rootDir: string }
      | undefined;
    const cli = createCli({
      cwd: () => 'C:/project',
      output: () => undefined,
      init: async () => undefined,
      validate: async () => 0,
      diff: async () => 0,
      sync: async () => 0,
      status: async () => 0,
      register: async (options) => {
        received = options;
        return 0;
      },
      getenv: (name) => {
        if (name === 'DEPLOYHUB_URL') return 'https://hub.example';
        if (name === 'DEPLOYHUB_TOKEN') return 'dh_reg_environment-only';
        return undefined;
      },
      setExitCode: () => undefined,
    });

    await cli.parseAsync(['node', 'deployhub', 'register', '--draft']);

    expect(received).toMatchObject({
      rootDir: 'C:/project',
      baseUrl: 'https://hub.example',
      token: 'dh_reg_environment-only',
    });
  });

  it('does not expose a --token option on any command', () => {
    const cli = createCli({
      cwd: () => 'C:/project',
      output: () => undefined,
      init: async () => undefined,
      validate: async () => 0,
      ...commandDependencies,
      getenv: () => undefined,
      setExitCode: () => undefined,
    });

    const tokenOptions = cli.commands.flatMap((command) =>
      command.options.filter((option) => option.long === '--token'),
    );
    expect(tokenOptions).toEqual([]);
  });

  it('fails clearly when DEPLOYHUB_URL is absent', async () => {
    const cli = createCli({
      cwd: () => 'C:/project',
      output: () => undefined,
      init: async () => undefined,
      validate: async () => 0,
      ...commandDependencies,
      getenv: () => undefined,
      setExitCode: () => undefined,
    });

    await expect(
      cli.parseAsync(['node', 'deployhub', 'status']),
    ).rejects.toThrow('DEPLOYHUB_URL environment variable is required');
  });

  it('fails clearly when DEPLOYHUB_TOKEN is absent for Draft submission', async () => {
    const cli = createCli({
      cwd: () => 'C:/project',
      output: () => undefined,
      init: async () => undefined,
      validate: async () => 0,
      ...commandDependencies,
      getenv: (name) =>
        name === 'DEPLOYHUB_URL' ? 'https://hub.example' : undefined,
      setExitCode: () => undefined,
    });

    await expect(
      cli.parseAsync(['node', 'deployhub', 'register', '--draft']),
    ).rejects.toThrow('DEPLOYHUB_TOKEN environment variable is required');
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
