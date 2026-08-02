// @vitest-environment happy-dom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectSheet, type ProjectSheetProject } from './project-sheet';
import type { Tone } from '../ui/badge';

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
  snapshotMode: 'automatic' as const,
  snapshot: {
    hasImage: false,
    source: null,
    capturedAt: null,
    checksum: null,
    lastAttemptStatus: null,
  },
};

let roots: Root[] = [];

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots = [];
});

async function renderExpanded(
  project: ProjectSheetProject,
  tone: Tone = 'neutral',
) {
  const container = document.createElement('div');
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(createElement(ProjectSheet, { project, tone }));
  });
  return { container, markup: container.innerHTML };
}

describe('ProjectSheet rendering', () => {
  it('server-renders only the toggle and project name before collapse state restoration', () => {
    const markup = renderToStaticMarkup(createElement(ProjectSheet, {
      project: {
        ...baseProject,
        repository: 'gnghkim/DeployHub',
        judgement: '장애',
        latestDeploymentAt: new Date('2026-08-01T00:00:00.000Z'),
        latestDeploymentRelative: '1일 전',
      },
      tone: 'fault',
    }));

    const container = document.createElement('div');
    container.innerHTML = markup;

    const toggle = container.querySelector<HTMLButtonElement>('button');
    expect(toggle).not.toBeNull();
    if (!toggle) throw new Error('Collapse toggle was not rendered');

    expect(toggle.getAttribute('aria-label')).toBe('DeployHub 펼치기');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.hasAttribute('aria-controls')).toBe(false);
    expect(container.querySelectorAll('a[href="/projects/deployhub"]')).toHaveLength(1);
    expect(container.textContent).toContain('DeployHub');
    expect(container.textContent).not.toContain('장애');
    expect(container.textContent).not.toContain('1일 전');
    expect(container.textContent).not.toContain('gnghkim/DeployHub');
    expect(container.querySelector('[data-testid="project-card-body"]')).toBeNull();
  });

  it('판정을 색 점뿐 아니라 읽을 수 있는 텍스트로 렌더한다', async () => {
    const { markup } = await renderExpanded(baseProject);

    expect(markup).toContain('>미확인</span>');
  });

  it('collapses a restored card to only its toggle and project name, then restores the full header', async () => {
    const { container } = await renderExpanded({
      ...baseProject,
      judgement: '장애',
      latestDeploymentAt: new Date('2026-08-01T00:00:00.000Z'),
      latestDeploymentRelative: '1일 전',
    }, 'fault');
    const button = container.querySelector<HTMLButtonElement>('button');
    expect(container.textContent).toContain('장애');
    expect(container.textContent).toContain('1일 전');
    expect(container.querySelector('[data-testid="project-card-body"]')).not.toBeNull();

    await act(async () => button?.click());
    expect(container.textContent?.replace(/\s/g, '')).toBe('▸DeployHub');
    expect(container.textContent).not.toContain('장애');
    expect(container.textContent).not.toContain('1일 전');
    expect(container.querySelector('[data-testid="project-card-body"]')).toBeNull();

    await act(async () => button?.click());
    expect(container.textContent).toContain('장애');
    expect(container.textContent).toContain('1일 전');
    expect(container.querySelector('[data-testid="project-card-body"]')).not.toBeNull();
  });

  it('구성요소가 0개여도 프로젝트를 렌더한다', async () => {
    const { markup } = await renderExpanded(baseProject);

    expect(markup).toContain('DeployHub');
    expect(markup).not.toContain('undefined');
  });

  it('관측이 0개면 Annotation의 관측 부재를 렌더한다', async () => {
    const { markup } = await renderExpanded({
      ...baseProject,
      components: [{
        id: 'component-1',
        name: 'worker',
        url: null,
      }],
    });

    expect(markup).toContain('관측되지 않음');
  });

  it('도메인과 URL이 없어도 빈 자리표시자 없이 렌더한다', async () => {
    const { markup } = await renderExpanded({
      ...baseProject,
      components: [{
        id: 'component-1',
        name: 'web',
        url: null,
      }],
    });

    expect(markup).not.toContain('href="null"');
    expect(markup).not.toContain('도메인 없음');
  });

  it('긴 식별자는 375px에서 줄바꿈할 수 있는 클래스를 쓴다', async () => {
    const { markup } = await renderExpanded({
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
    });

    expect(markup).toContain('min-w-0');
    expect(markup).toContain('break-all');
    expect(markup).toContain('overflow-hidden');
  });

  it('renders snapshot metadata on the left and a lazy 16:10 preview on the right', async () => {
    const capturedAt = new Date('2026-08-01T03:04:00.000Z');
    const { container } = await renderExpanded({
      ...baseProject,
      repository: 'gnghkim/DeployHub',
      snapshot: {
        hasImage: true,
        source: 'automatic' as const,
        capturedAt,
        checksum: 'sha/value',
        lastAttemptStatus: 'success' as const,
      },
    });
    const body = container.querySelector('[data-testid="project-card-body"]');
    const information = container.querySelector('[data-testid="project-information"]');
    const preview = container.querySelector('[data-testid="project-snapshot-preview"]');
    expect(body?.className).toContain('lg:grid-cols-[minmax(0,1fr)_minmax(20rem,42%)]');
    expect(body?.firstElementChild).toBe(information);
    expect(body?.lastElementChild).toBe(preview);

    const link = preview?.querySelector<HTMLAnchorElement>(
      'a[href="/api/projects/deployhub/snapshot?checksum=sha%2Fvalue"]',
    );
    expect(link?.target).toBe('_blank');
    expect(link?.rel).toBe('noreferrer');
    const image = link?.querySelector('img');
    expect(image?.loading).toBe('lazy');
    expect(image?.className).toContain('object-contain');
    expect(image?.closest('[data-testid="snapshot-frame"]')?.className)
      .toContain('aspect-[16/10]');
    expect(preview?.textContent).toContain('자동 캡처');
    expect(preview?.textContent).toContain('정상');
    expect(preview?.querySelector(`time[datetime="${capturedAt.toISOString()}"]`))
      .not.toBeNull();
  });

  it('keeps the previous image visible with an updating badge', async () => {
    const { container } = await renderExpanded({
      ...baseProject,
      snapshot: {
        hasImage: true,
        source: 'manual' as const,
        capturedAt: new Date('2026-08-01T03:04:00.000Z'),
        checksum: 'old-checksum',
        lastAttemptStatus: 'pending' as const,
      },
    });
    const preview = container.querySelector('[data-testid="project-snapshot-preview"]');
    expect(preview?.querySelector('img')).not.toBeNull();
    expect(preview?.textContent).toContain('갱신 중');
    expect(preview?.textContent).toContain('수동 업로드');
  });

  it('links an empty snapshot preview to project settings', async () => {
    const { container } = await renderExpanded(baseProject);
    const preview = container.querySelector('[data-testid="project-snapshot-preview"]');
    expect(preview?.textContent).toContain('등록된 스냅샷이 없습니다.');
    expect(preview?.querySelector('a[href="/projects/deployhub/edit"]'))
      .not.toBeNull();
  });
});
