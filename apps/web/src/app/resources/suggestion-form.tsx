'use client';

import Link from 'next/link';
import { useState } from 'react';
import { confirmResourceLink } from '../../actions/links';
import { Button } from '../../components/ui/button';

type ComponentOption = {
  id: string;
  name: string;
};

export function SuggestionForm({
  resourceId,
  projectSlug,
  components,
}: {
  resourceId: string;
  projectSlug: string;
  components: ComponentOption[];
}) {
  const [ignored, setIgnored] = useState(false);

  if (ignored) {
    return (
      <p className="text-sm text-[var(--color-mute)]">
        이 조회에서 무시했습니다.
      </p>
    );
  }

  if (components.length === 0) {
    return (
      <p className="text-sm text-[var(--color-mute)]">
        연결할 구성요소가 없습니다.{' '}
        <Link
          href={`/projects/${projectSlug}/components/new`}
          className="text-[var(--color-info)] hover:underline"
        >
          구성요소 추가
        </Link>
        후 선택해 주세요.
      </p>
    );
  }

  return (
    <form action={confirmResourceLink} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="resourceId" value={resourceId} />
      <label className="text-xs text-[var(--color-mute)]">
        구성요소
        <select
          name="componentId"
          required
          className="ml-2 h-9 rounded-[var(--radius-button)] border border-[var(--color-hairline)] bg-[var(--color-surface-elevated)] px-3 text-sm text-[var(--color-ink)]"
        >
          {components.map((component) => (
            <option key={component.id} value={component.id}>
              {component.name}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="primary">확인</Button>
      <Button
        type="button"
        variant="tertiary"
        onClick={() => setIgnored(true)}
      >
        무시
      </Button>
    </form>
  );
}
