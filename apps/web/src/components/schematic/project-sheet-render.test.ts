// @vitest-environment happy-dom

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProjectSheet } from './project-sheet';

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
  it('renders an expanded collapsible card with its header and details', () => {
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

    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="DeployHub 접기"]',
    );
    expect(toggle).not.toBeNull();
    if (!toggle) throw new Error('Collapse toggle was not rendered');

    const detailsId = toggle.getAttribute('aria-controls');
    expect(detailsId).toBe('project-card-details-project-1');

    const details = container.querySelector(`[id="${detailsId}"]`);
    expect(details).not.toBeNull();
    if (!details) throw new Error('Controlled details region was not rendered');

    expect(details.textContent).toContain('gnghkim/DeployHub');

    const projectLink = container.querySelector('a[href="/projects/deployhub"]');
    expect(projectLink).not.toBeNull();
    if (!projectLink) throw new Error('Project link was not rendered');
    expect(details.contains(projectLink)).toBe(false);
    expect(projectLink.className).toContain('hover:underline');
    expect(projectLink.className).toContain('focus-visible:underline');
    expect(projectLink.className).toContain('focus-visible:outline-2');

    const badge = Array.from(container.querySelectorAll('span')).find(
      (element) => element.textContent === '장애',
    );
    expect(badge).toBeDefined();
    if (!badge) throw new Error('Status badge was not rendered');
    expect(details.contains(badge)).toBe(false);

    const time = container.querySelector('time');
    expect(time).not.toBeNull();
    if (!time) throw new Error('Deployment time was not rendered');
    expect(time.textContent).toBe('1일 전');
    expect(details.contains(time)).toBe(false);

    expect(markup).toContain('aria-label="DeployHub 접기"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-controls="project-card-details-project-1"');
    expect(markup).toContain('id="project-card-details-project-1"');
  });

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
