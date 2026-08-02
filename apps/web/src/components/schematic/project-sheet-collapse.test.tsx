// @vitest-environment happy-dom

import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectSheetCollapse } from './project-sheet-collapse';

const storageKey = (projectId: string) =>
  `deployhub:project-card-collapsed:v1:${projectId}`;

describe('ProjectSheetCollapse', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function render(projectId = 'project-1', projectName = 'DeployHub') {
    await act(async () => {
      root.render(
        <ProjectSheetCollapse
          projectId={projectId}
          projectName={projectName}
          header={<span data-testid="header">Project header</span>}
          trailing={<span data-testid="trailing">Just now</span>}
        >
          <span data-testid="information">Project information</span>
          <span data-testid="snapshot">Project snapshot</span>
        </ProjectSheetCollapse>,
      );
    });
  }

  function toggleButton() {
    return container.querySelector('button');
  }

  function details(projectId: string) {
    return container.querySelector<HTMLDivElement>(
      `#project-card-details-${projectId}`,
    );
  }

  it('starts expanded with an accessible toggle that controls the details', async () => {
    await render();

    const button = toggleButton();
    const detailsRegion = details('project-1');
    expect(button?.getAttribute('aria-label')).toBe('DeployHub 접기');
    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(button?.getAttribute('aria-controls')).toBe(detailsRegion?.id);
    expect(detailsRegion?.hidden).toBe(false);
  });

  it('removes information and snapshot bodies while retaining only the header', async () => {
    await render();

    await act(async () => toggleButton()?.click());

    expect(details('project-1')).toBeNull();
    expect(container.querySelector('[data-testid="information"]')).toBeNull();
    expect(container.querySelector('[data-testid="snapshot"]')).toBeNull();
    expect(toggleButton()?.getAttribute('aria-expanded')).toBe('false');
    expect(toggleButton()?.hasAttribute('aria-controls')).toBe(false);
    expect(toggleButton()?.getAttribute('aria-label')).toBe('DeployHub 펼치기');
    expect(container.querySelector('[data-testid="header"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="trailing"]')).not.toBeNull();
    expect(localStorage.getItem(storageKey('project-1'))).toBe('1');

    await act(async () => toggleButton()?.click());

    expect(details('project-1')?.hidden).toBe(false);
    expect(container.querySelector('[data-testid="information"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="snapshot"]')).not.toBeNull();
    expect(toggleButton()?.getAttribute('aria-expanded')).toBe('true');
    expect(toggleButton()?.getAttribute('aria-controls')).toBe(details('project-1')?.id);
    expect(toggleButton()?.getAttribute('aria-label')).toBe('DeployHub 접기');
    expect(localStorage.getItem(storageKey('project-1'))).toBeNull();
  });

  it('restores a stored collapse for one project without affecting another', async () => {
    localStorage.setItem(storageKey('project-1'), '1');
    await act(async () => {
      root.render(
        <>
          <ProjectSheetCollapse
            projectId="project-1"
            projectName="DeployHub"
            header={<span>First project</span>}
          >
            First details
          </ProjectSheetCollapse>
          <ProjectSheetCollapse
            projectId="project-2"
            projectName="Other project"
            header={<span>Second project</span>}
          >
            Second details
          </ProjectSheetCollapse>
        </>,
      );
    });
    expect(details('project-1')).toBeNull();
    expect(details('project-2')?.hidden).toBe(false);
  });

  it('persists each click once when StrictMode replays rendering', async () => {
    const setItem = vi.spyOn(localStorage, 'setItem');
    const removeItem = vi.spyOn(localStorage, 'removeItem');

    await act(async () => {
      root.render(
        <StrictMode>
          <ProjectSheetCollapse
            projectId="project-1"
            projectName="DeployHub"
            header={<span>Project header</span>}
          >
            Project details
          </ProjectSheetCollapse>
        </StrictMode>,
      );
    });

    await act(async () => toggleButton()?.click());
    expect(setItem).toHaveBeenCalledOnce();
    expect(setItem).toHaveBeenCalledWith(storageKey('project-1'), '1');

    await act(async () => toggleButton()?.click());
    expect(removeItem).toHaveBeenCalledOnce();
    expect(removeItem).toHaveBeenCalledWith(storageKey('project-1'));
  });

  it('keeps toggling in memory when storage operations fail', async () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('unavailable');
    });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('unavailable');
    });
    vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('unavailable');
    });
    await render();

    await act(async () => toggleButton()?.click());
    expect(details('project-1')).toBeNull();

    await act(async () => toggleButton()?.click());
    expect(details('project-1')?.hidden).toBe(false);
  });
});
