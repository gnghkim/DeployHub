import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const page = readFileSync(
  fileURLToPath(new URL('./page.tsx', import.meta.url)),
  'utf8',
);
const markdown = readFileSync(
  fileURLToPath(
    new URL(
      '../../../../../docs/ai-project-registration-manual.md',
      import.meta.url,
    ),
  ),
  'utf8',
);

const sections = [
  ['scope', '이 매뉴얼의 범위'],
  ['quick-start', '5분 빠른 시작'],
  ['prerequisites', '시작 전에 준비할 것'],
  ['new-project', '신규 프로젝트 등록 맡기기'],
  ['existing-project', '기존 프로젝트 정보 갱신 맡기기'],
  ['ai-procedure', 'AI가 따라야 하는 절차'],
  ['draft-review', 'Draft에서 사용자가 확인할 것'],
  ['safety', '비밀정보와 추측 방지 원칙'],
  ['troubleshooting', '문제가 생겼을 때 다시 요청하기'],
  ['completion-report', 'AI의 완료 보고 예시'],
  ['references', '더 자세한 문서'],
] as const;

function sliceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
}

function fencedTextBetweenHeadings(
  source: string,
  startHeading: string,
  endHeading: string,
) {
  const section = sliceBetween(source, startHeading, endHeading);
  const match = section.match(/```text\r?\n([\s\S]*?)\r?\n```/);

  expect(match).not.toBeNull();

  return match?.[1] ?? '';
}

describe('in-app manual page', () => {
  it('renders every approved section with a matching table-of-contents anchor', () => {
    for (const [id, title] of sections) {
      expect(page).toContain(`id="${id}"`);
      expect(page).toContain(`{ id: '${id}', label: '${title}' }`);
      expect(page).toContain(title);
      expect(markdown).toContain(title);
    }
    expect(page).toContain('href={`#${item.id}`}');
  });

  it('keeps both delegation prompts and every CLI operation', () => {
    for (const content of [
      'DeployHub 신규 등록을 준비해줘.',
      'DeployHub 등록 정보와 비교해줘.',
      'init --detect',
      'validate',
      'register --draft',
      'status',
      'diff',
      'sync --draft',
    ]) {
      expect(page).toContain(content);
      expect(markdown).toContain(content);
    }
    expect(page.match(/<CopyablePrompt/g)?.length).toBeGreaterThanOrEqual(6);
  });

  it('makes both copied prompts self-contained and avoids CLI discovery detours', () => {
    const promptPairs = [
      {
        pagePrompt: sliceBetween(
          page,
          'const NEW_PROJECT_PROMPT',
          'const EXISTING_PROJECT_PROMPT',
        ),
        markdownPrompt: fencedTextBetweenHeadings(
          markdown,
          '## 신규 프로젝트 등록 맡기기',
          '## 기존 프로젝트 정보 갱신 맡기기',
        ),
        commands: [
          'npx @deployhub/cli init --detect',
          'npx @deployhub/cli validate',
          'npx @deployhub/cli register --draft',
        ],
      },
      {
        pagePrompt: sliceBetween(
          page,
          'const EXISTING_PROJECT_PROMPT',
          'const REINVESTIGATE_PROMPT',
        ),
        markdownPrompt: fencedTextBetweenHeadings(
          markdown,
          '## 기존 프로젝트 정보 갱신 맡기기',
          '## AI가 따라야 하는 절차',
        ),
        commands: [
          'npx @deployhub/cli status',
          'npx @deployhub/cli diff',
          'npx @deployhub/cli validate',
          'npx @deployhub/cli sync --draft',
        ],
      },
    ] as const;

    for (const { pagePrompt, markdownPrompt, commands } of promptPairs) {
      for (const prompt of [pagePrompt, markdownPrompt]) {
        for (const command of commands) {
          expect(prompt).toContain(command);
        }
        expect(prompt).toContain('웹에서 검색하지 마');
        expect(prompt).toContain('전역 설치하지 마');
        expect(prompt).toContain('현재 터미널 환경변수만 사용');
        expect(prompt).toContain('기존 작업 파일을 수정하거나 커밋하지 마');
        expect(prompt).toContain('자동으로 재시도하지 마');
      }
    }
  });

  it('documents safe environment handoff, recovery, and cleanup', () => {
    const requiredGuidance = [
      "Read-Host 'DEPLOYHUB_TOKEN' -AsSecureString",
      "SetEnvironmentVariable('DEPLOYHUB_TOKEN', $plainToken, 'User')",
      '이미 실행 중인 Orca/AI',
      '완전히 종료하고 새로 시작',
      'DEPLOYHUB_URL_PRESENT=$urlPresent',
      'DEPLOYHUB_TOKEN_PRESENT=$tokenPresent',
      '값, 길이, 접두사 또는 일부 문자열',
      '동일한 PowerShell 호출',
      "SetEnvironmentVariable('DEPLOYHUB_TOKEN', $null, 'User')",
      '즉시 폐기하고 새 토큰을 발급',
    ];

    for (const source of [page, markdown]) {
      for (const guidance of requiredGuidance) {
        expect(source).toContain(guidance);
      }
    }

    expect(page).toContain('const ENVIRONMENT_RECOVERY_PROMPT');
    expect(page).toContain(
      '<CopyablePrompt>{ENVIRONMENT_RECOVERY_PROMPT}</CopyablePrompt>',
    );
  });

  it('preserves the deployment and secret-handling boundaries', () => {
    expect(page).toContain('대상 프로젝트의 실제 서비스 배포는 다루지');
    expect(page).toContain(
      'DeployHub 자체 서비스의 배포는 다루지 않습니다',
    );
    expect(page).toContain('토큰 값은 AI 대화에 붙여 넣지 않습니다');
    expect(page).toContain(
      'provider, externalRef, container, 운영 URL은 추측하지 마',
    );
  });

  it('is a database-free server page with responsive navigation', () => {
    expect(page).not.toContain("'use client'");
    expect(page).not.toContain("from '@/lib/db'");
    expect(page).not.toContain('@deployhub/db');
    expect(page).toContain('aria-label="매뉴얼 목차"');
    expect(page).toContain('lg:sticky');
    expect(page).toContain('lg:hidden');
    expect(page).toContain('hidden lg:block');
    expect(page).toContain('overflow-x-auto');
  });
});
