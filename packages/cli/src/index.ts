#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { runDiff, type DiffOptions } from './commands/diff';
import { runInit } from './commands/init';
import { runRegister, type RegisterOptions } from './commands/register';
import { runStatus, type StatusOptions } from './commands/status';
import { runSync, type SyncOptions } from './commands/sync';
import { runValidate } from './commands/validate';

type InitCommandOptions = {
  rootDir: string;
  detect: boolean;
  force?: boolean;
  schemaUrl: string;
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
  register: (options: RegisterOptions) => Promise<number>;
  diff: (options: DiffOptions) => Promise<number>;
  sync: (options: SyncOptions) => Promise<number>;
  status: (options: StatusOptions) => Promise<number>;
  getenv: (name: string) => string | undefined;
  setExitCode: (code: number) => void;
};

const defaultDependencies: CliDependencies = {
  cwd: process.cwd,
  output: console.log,
  init: runInit,
  validate: runValidate,
  register: runRegister,
  diff: runDiff,
  sync: runSync,
  status: runStatus,
  getenv: (name) => process.env[name],
  setExitCode: (code) => {
    process.exitCode = code;
  },
};

function requiredEnvironment(
  dependencies: CliDependencies,
  name: 'DEPLOYHUB_TOKEN' | 'DEPLOYHUB_URL',
): string {
  const value = dependencies.getenv(name);
  if (!value?.trim()) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

export function createCli(
  dependencies: CliDependencies = defaultDependencies,
): Command {
  const program = new Command()
    .name('deployhub')
    .description('Detect, validate, and submit DeployHub project manifests')
    .showHelpAfterError();

  program
    .command('init')
    .description('Create deployhub.yaml')
    .option('--detect', 'detect project components')
    .option('--force', 'overwrite an existing deployhub.yaml')
    .action(async (options: { detect?: boolean; force?: boolean }) => {
      const baseUrl = requiredEnvironment(dependencies, 'DEPLOYHUB_URL');
      await dependencies.init({
        rootDir: dependencies.cwd(),
        detect: options.detect ?? false,
        ...(options.force ? { force: true } : {}),
        schemaUrl: `${baseUrl.replace(/\/+$/, '')}/schemas/deployhub-v1.json`,
        output: dependencies.output,
      });
    });

  program
    .command('validate')
    .description('Validate deployhub.yaml with the server schema')
    .option('--remote', 'also request server-side validation')
    .action(
      async (options: { remote?: boolean }) => {
        const exitCode = await dependencies.validate({
          rootDir: dependencies.cwd(),
          baseUrl: requiredEnvironment(dependencies, 'DEPLOYHUB_URL'),
          remote: options.remote ?? false,
          output: dependencies.output,
        });
        dependencies.setExitCode(exitCode);
      },
    );

  program
    .command('register')
    .description('Submit a new project manifest as a Draft')
    .requiredOption('--draft', 'submit for human review as a Draft')
    .action(async () => {
      const exitCode = await dependencies.register({
        rootDir: dependencies.cwd(),
        baseUrl: requiredEnvironment(dependencies, 'DEPLOYHUB_URL'),
        token: requiredEnvironment(dependencies, 'DEPLOYHUB_TOKEN'),
        output: dependencies.output,
      });
      dependencies.setExitCode(exitCode);
    });

  program
    .command('diff')
    .description('Compare deployhub.yaml with the current server declaration')
    .action(async () => {
      const exitCode = await dependencies.diff({
        rootDir: dependencies.cwd(),
        baseUrl: requiredEnvironment(dependencies, 'DEPLOYHUB_URL'),
        token: requiredEnvironment(dependencies, 'DEPLOYHUB_TOKEN'),
        output: dependencies.output,
      });
      dependencies.setExitCode(exitCode);
    });

  program
    .command('sync')
    .description('Submit changes to an existing project as a Draft')
    .requiredOption('--draft', 'submit for human review as a Draft')
    .action(async () => {
      const exitCode = await dependencies.sync({
        rootDir: dependencies.cwd(),
        baseUrl: requiredEnvironment(dependencies, 'DEPLOYHUB_URL'),
        token: requiredEnvironment(dependencies, 'DEPLOYHUB_TOKEN'),
        output: dependencies.output,
      });
      dependencies.setExitCode(exitCode);
    });

  program
    .command('status')
    .description('Show project registration and connection status')
    .action(async () => {
      const exitCode = await dependencies.status({
        rootDir: dependencies.cwd(),
        baseUrl: requiredEnvironment(dependencies, 'DEPLOYHUB_URL'),
        token: requiredEnvironment(dependencies, 'DEPLOYHUB_TOKEN'),
        output: dependencies.output,
      });
      dependencies.setExitCode(exitCode);
    });

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
