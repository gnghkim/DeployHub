#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { runInit } from './commands/init';
import { runValidate } from './commands/validate';

const DEFAULT_BASE_URL = 'https://hub.nolzza.net';

type InitCommandOptions = {
  rootDir: string;
  detect: boolean;
  force?: boolean;
  output: (line: string) => void;
};

type ValidateCommandOptions = {
  rootDir: string;
  baseUrl: string;
  remote: boolean;
  output: (line: string) => void;
};

export type CliDependencies = {
  cwd: () => string;
  output: (line: string) => void;
  init: (options: InitCommandOptions) => Promise<unknown>;
  validate: (options: ValidateCommandOptions) => Promise<number>;
  setExitCode: (code: number) => void;
};

const defaultDependencies: CliDependencies = {
  cwd: process.cwd,
  output: console.log,
  init: runInit,
  validate: runValidate,
  setExitCode: (code) => {
    process.exitCode = code;
  },
};

export function createCli(
  dependencies: CliDependencies = defaultDependencies,
): Command {
  const program = new Command()
    .name('deployhub')
    .description('Detect and validate DeployHub project manifests')
    .showHelpAfterError();

  program
    .command('init')
    .description('Create deployhub.yaml')
    .option('--detect', 'detect project components')
    .option('--force', 'overwrite an existing deployhub.yaml')
    .action(async (options: { detect?: boolean; force?: boolean }) => {
      await dependencies.init({
        rootDir: dependencies.cwd(),
        detect: options.detect ?? false,
        ...(options.force ? { force: true } : {}),
        output: dependencies.output,
      });
    });

  program
    .command('validate')
    .description('Validate deployhub.yaml with the server schema')
    .option('--remote', 'also request server-side validation')
    .option('--base-url <url>', 'DeployHub server URL', DEFAULT_BASE_URL)
    .action(
      async (options: { remote?: boolean; baseUrl: string }) => {
        const exitCode = await dependencies.validate({
          rootDir: dependencies.cwd(),
          baseUrl: options.baseUrl,
          remote: options.remote ?? false,
          output: dependencies.output,
        });
        dependencies.setExitCode(exitCode);
      },
    );

  return program;
}

export function isMainModule(
  invokedPath: string | undefined,
  moduleUrl: string,
  canonicalize: (path: string) => string = realpathSync,
): boolean {
  if (!invokedPath) return false;
  const invoked = resolve(invokedPath);
  const modulePath = resolve(fileURLToPath(moduleUrl));
  try {
    return canonicalize(invoked) === canonicalize(modulePath);
  } catch {
    return invoked === modulePath;
  }
}

if (isMainModule(process.argv[1], import.meta.url)) {
  createCli().parseAsync(process.argv).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
