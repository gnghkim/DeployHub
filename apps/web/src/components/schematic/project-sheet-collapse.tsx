'use client';

import { useEffect, useState, type ReactNode } from 'react';

type ProjectSheetCollapseProps = {
  projectId: string;
  projectName: string;
  collapsedHeader: ReactNode;
  header: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
};

function storageKey(projectId: string) {
  return `deployhub:project-card-collapsed:v1:${projectId}`;
}

export function ProjectSheetCollapse({
  projectId,
  projectName,
  collapsedHeader,
  header,
  trailing = null,
  children,
}: ProjectSheetCollapseProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [restored, setRestored] = useState(false);
  const detailsId = `project-card-details-${projectId}`;

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(storageKey(projectId)) === '1');
    } catch {
      setCollapsed(false);
    }
    setRestored(true);
  }, [projectId]);

  const expanded = restored && !collapsed;

  function toggle() {
    const nextCollapsed = !collapsed;

    try {
      if (nextCollapsed) {
        window.localStorage.setItem(storageKey(projectId), '1');
      } else {
        window.localStorage.removeItem(storageKey(projectId));
      }
    } catch {
      // Local storage can be unavailable, but the control should still work.
    }

    setCollapsed(nextCollapsed);
  }

  return (
    <>
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <button
            aria-controls={expanded ? detailsId : undefined}
            aria-expanded={expanded}
            aria-label={`${projectName} ${expanded ? '접기' : '펼치기'}`}
            className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded text-[var(--absent)] hover:bg-[var(--rule)] hover:text-[var(--line)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--line)]"
            onClick={toggle}
            type="button"
          >
            {expanded ? '▾' : '▸'}
          </button>
          <div className="flex min-w-0 flex-wrap items-baseline gap-2">
            {expanded ? header : collapsedHeader}
          </div>
        </div>
        {expanded ? trailing : null}
      </header>

      {expanded ? (
        <div id={detailsId}>
          {children}
        </div>
      ) : null}
    </>
  );
}
