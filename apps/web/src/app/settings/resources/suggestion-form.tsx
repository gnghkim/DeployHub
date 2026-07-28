'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import {
  confirmResourceLink,
  type ResourceLinkActionState,
} from '../../../actions/links';
import { Button } from '../../../components/ui/button';

type ComponentOption = {
  id: string;
  name: string;
};

const INITIAL_STATE: ResourceLinkActionState = { status: 'idle' };

export function SuggestionForm({
  resourceId,
  projectSlug,
  components,
}: {
  resourceId: string;
  projectSlug?: string;
  components: ComponentOption[];
}) {
  const [ignored, setIgnored] = useState(false);
  const [state, formAction, pending] = useActionState(
    confirmResourceLink,
    INITIAL_STATE,
  );

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
          href={projectSlug ? `/projects/${projectSlug}/components/new` : '/projects'}
          className="text-[var(--color-info)] hover:underline"
        >
          구성요소 추가
        </Link>
        후 선택해 주세요.
      </p>
    );
  }

  return (
    <form action={formAction} className="flex min-w-0 flex-wrap items-center gap-2">
      <input type="hidden" name="resourceId" value={resourceId} />
      <label className="min-w-0 max-w-full text-xs text-[var(--color-mute)]">
        구성요소
        <select
          name="componentId"
          required
          className="mt-1 block h-9 min-w-0 max-w-full rounded-[var(--radius-button)] border border-[var(--color-hairline)] bg-[var(--color-surface-elevated)] px-3 text-sm text-[var(--color-ink)] sm:ml-2 sm:mt-0 sm:inline-block"
        >
          {components.map((component) => (
            <option key={component.id} value={component.id}>
              {component.name}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? '연결 중…' : '확인'}
      </Button>
      <Button
        type="button"
        variant="tertiary"
        onClick={() => setIgnored(true)}
      >
        무시
      </Button>
      {state.message ? (
        <p
          role="status"
          className={`w-full text-xs ${
            state.status === 'success'
              ? 'text-[var(--color-success)]'
              : 'text-[var(--color-error)]'
          }`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
