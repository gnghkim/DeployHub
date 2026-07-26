import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseManifest,
  type Manifest,
  type ParseResult,
} from '@deployhub/manifest';
import { runValidate } from './validate';

export type CommandOutput = (line: string) => void;
export type CommandValidator = (
  rootDir: string,
  baseUrl: string,
  output: CommandOutput,
) => Promise<0 | 1>;

export type LocalManifest = {
  manifest: Manifest;
  yamlText: string;
};

export async function readLocalManifest(
  rootDir: string,
  output: CommandOutput,
): Promise<LocalManifest | undefined> {
  const yamlText = await readFile(join(rootDir, 'deployhub.yaml'), 'utf8');
  const parsed: ParseResult = parseManifest(yamlText);
  if (!parsed.ok) {
    for (const issue of parsed.errors) {
      output(
        `ERROR ${issue.path || '<root>'}: ${issue.message}`,
      );
    }
    return undefined;
  }
  for (const warning of parsed.warnings) {
    output(
      `WARNING ${warning.path || '<root>'}: ${warning.message}`,
    );
  }
  return { manifest: parsed.manifest, yamlText };
}

export const validateWithServerSchema: CommandValidator = async (
  rootDir,
  baseUrl,
  output,
) =>
  runValidate({
    rootDir,
    baseUrl,
    remote: false,
    output,
  });

export function absoluteDeployHubUrl(
  baseUrl: string,
  path: string,
): string {
  return new URL(path, `${baseUrl.replace(/\/+$/, '')}/`).toString();
}
