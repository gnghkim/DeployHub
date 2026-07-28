import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const page = readFileSync(
  fileURLToPath(new URL('./page.tsx', import.meta.url)),
  'utf8',
);

describe('발견 화면', () => {
  it('미등록 Docker 스택과 컨테이너 관측값을 표시한다', () => {
    expect(page).not.toContain("'use client'");
    expect(page).toContain('listDiscoveredStacks');
    expect(page).toContain('발견됨 {stacks.length}');
    expect(page).toContain('관측됐지만 아직 등록되지 않은 스택입니다');
    expect(page).toContain('컨테이너 {stack.containers.length}');
    expect(page).toContain('{container.name}');
    expect(page).toContain("{container.status ?? '—'}");
    expect(page).toContain('{container.image ?? \'\'}');
  });

  it('AI와 등록 초안 승인으로 이어지는 기존 등록 방식을 한 번 안내한다', () => {
    expect(page).toContain(
      '등록하려면 해당 프로젝트를 작업 중인 AI에게',
    );
    expect(page).toContain('DeployHub에 등록해줘');
    expect(page).toContain('AI가 deployhub.yaml 을 만들어 올리면');
    expect(page).toContain('등록 초안 화면');
    expect(page).toContain('에서 승인합니다.');
    expect(page).toContain('href="/settings/drafts"');
    expect(page.match(/DeployHub에 등록해줘/g)).toHaveLength(1);
  });

  it('등록 동작이나 경고 판정을 만들지 않는다', () => {
    expect(page).not.toContain('등록' + '하기');
    expect(page).not.toContain('register' + 'Stack');
    expect(page).not.toContain('tone="warning"');
    expect(page).not.toContain('tone="error"');
  });

  it('발견된 스택이 없으면 좋은 상태임을 명확히 표시한다', () => {
    expect(page).toContain(
      '모든 실행 중인 스택이 등록되어 있습니다',
    );
    expect(page).not.toContain('데이터 없음');
  });
});
