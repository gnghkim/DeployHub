import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

type CompilableModule = {
  _compile(source: string, filename: string): void;
};

type ProviderAccountCardComponent = (
  props: {
    id: string;
    name: string;
    tokenSuffix: string;
    lastVerifiedAt: Date | null;
    lastSyncAt: Date | null;
    lastError: string | null;
    syncAction: (formData: FormData) => Promise<void>;
  },
) => ReturnType<typeof createElement>;

const require = createRequire(import.meta.url);
const nodeModule = require('node:module') as {
  _extensions: Record<
    string,
    (module: CompilableModule, filename: string) => void
  >;
};
nodeModule._extensions['.tsx'] = (module, filename) => {
  const source = readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
    },
    fileName: filename,
  });
  module._compile(output.outputText, filename);
};

const componentPath = fileURLToPath(new URL(
  './components/provider-account-card.tsx',
  import.meta.url,
));

it('renders account metadata and only the token suffix', () => {
  expect(existsSync(componentPath)).toBe(true);

  const { ProviderAccountCard } = require(componentPath) as {
    ProviderAccountCard: ProviderAccountCardComponent;
  };
  const plaintextToken = 'vercel_plaintext_secret_1234';
  const markup = renderToStaticMarkup(createElement(ProviderAccountCard, {
    id: 'account-1',
    name: 'acme-team',
    tokenSuffix: plaintextToken.slice(-4),
    lastVerifiedAt: new Date('2026-07-30T01:00:00.000Z'),
    lastSyncAt: null,
    lastError: '동기화 실패',
    syncAction: async () => undefined,
  }));

  expect(markup).toContain('acme-team');
  expect(markup).toContain('••••1234');
  expect(markup).toContain('마지막 확인');
  expect(markup).toContain('마지막 동기화');
  expect(markup).toContain('동기화 실패');
  expect(markup).toContain('name="accountId"');
  expect(markup).toContain('value="account-1"');
  expect(markup).toContain('지금 동기화');
  expect(markup).not.toContain(plaintextToken);
});
