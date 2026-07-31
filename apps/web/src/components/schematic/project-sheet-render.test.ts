import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

type CompilableModule = {
  _compile(source: string, filename: string): void;
};

type ProjectSheetComponent = typeof import('./project-sheet').ProjectSheet;

const require = createRequire(import.meta.url);
const nodeModule = require('node:module') as {
  _extensions: Record<
    string,
    (module: CompilableModule, filename: string) => void
  >;
};
const compileTypeScript = (module: CompilableModule, filename: string) => {
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
nodeModule._extensions['.ts'] = compileTypeScript;
nodeModule._extensions['.tsx'] = compileTypeScript;

const { ProjectSheet } = require('./project-sheet.tsx') as {
  ProjectSheet: ProjectSheetComponent;
};

const baseProject = {
  id: 'project-1',
  slug: 'deployhub',
  name: 'DeployHub',
  repository: null,
  judgement: '미확인' as const,
  latestDeploymentAt: null,
  latestDeploymentRelative: null,
  deploymentLabel: null,
  components: [],
  componentObservations: new Map<string, { name: string; state: string }>(),
};

describe('ProjectSheet rendering', () => {
  it('판정을 색 점뿐 아니라 읽을 수 있는 텍스트로 렌더한다', () => {
    const markup = renderToStaticMarkup(createElement(ProjectSheet, {
      project: baseProject,
      tone: 'neutral',
    }));

    expect(markup).toContain('>미확인</span>');
  });

  it('구성요소가 0개여도 프로젝트를 렌더한다', () => {
    const markup = renderToStaticMarkup(createElement(ProjectSheet, {
      project: baseProject,
      tone: 'neutral',
    }));

    expect(markup).toContain('DeployHub');
    expect(markup).not.toContain('undefined');
  });

  it('관측이 0개면 Annotation의 관측 부재를 렌더한다', () => {
    const markup = renderToStaticMarkup(createElement(ProjectSheet, {
      project: {
        ...baseProject,
        components: [{
          id: 'component-1',
          name: 'worker',
          url: null,
        }],
      },
      tone: 'neutral',
    }));

    expect(markup).toContain('관측되지 않음');
  });

  it('도메인과 URL이 없어도 빈 자리표시자 없이 렌더한다', () => {
    const markup = renderToStaticMarkup(createElement(ProjectSheet, {
      project: {
        ...baseProject,
        components: [{
          id: 'component-1',
          name: 'web',
          url: null,
        }],
      },
      tone: 'neutral',
    }));

    expect(markup).not.toContain('href="null"');
    expect(markup).not.toContain('도메인 없음');
  });

  it('긴 식별자는 375px에서 줄바꿈할 수 있는 클래스를 쓴다', () => {
    const markup = renderToStaticMarkup(createElement(ProjectSheet, {
      project: {
        ...baseProject,
        name: '아주긴프로젝트이름이여러줄로안전하게줄바꿈되어야한다',
        repository: 'owner/a-very-long-repository-name-that-must-wrap',
        components: [{
          id: 'component-1',
          name: 'a-very-long-component-name-that-must-wrap',
          url: null,
        }],
        componentObservations: new Map([[
          'component-1',
          {
            name: 'a-very-long-container-name-that-must-wrap-without-overflow',
            state: 'running',
          },
        ]]),
      },
      tone: 'neutral',
    }));

    expect(markup).toContain('min-w-0');
    expect(markup).toContain('break-all');
    expect(markup).toContain('overflow-hidden');
  });
});
