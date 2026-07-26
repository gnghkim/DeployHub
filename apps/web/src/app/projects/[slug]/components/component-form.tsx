'use client';

import { useActionState } from 'react';
import type { ComponentRow } from '@deployhub/db';
import {
  createComponent,
  updateComponent,
  type ComponentActionState,
} from '../../../../actions/components';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { COMPONENT_TYPES } from '../../../../lib/schemas';

const INITIAL_STATE: ComponentActionState = { status: 'idle' };
const CONTROL_CLASS =
  'h-9 w-full rounded-[var(--radius-button)] border border-[var(--color-hairline)] bg-[var(--color-surface-elevated)] px-3 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-info)]';

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="mt-1 text-xs text-[var(--color-error)]">{messages[0]}</p>;
}

export function ComponentForm({
  projectId,
  component,
}: {
  projectId: string;
  component?: ComponentRow;
}) {
  const action = component
    ? updateComponent.bind(null, component.id)
    : createComponent.bind(null, projectId);
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-5">
      <div className="grid gap-5 md:grid-cols-2">
        <label className="block text-sm text-[var(--color-body)]">
          이름
          <Input
            className="mt-2"
            name="name"
            defaultValue={component?.name}
            maxLength={100}
            required
          />
          <FieldError messages={state.fieldErrors?.name} />
        </label>

        <label className="block text-sm text-[var(--color-body)]">
          Slug
          <Input
            className="mt-2"
            name="slug"
            defaultValue={component?.slug}
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            required
          />
          <FieldError messages={state.fieldErrors?.slug} />
        </label>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <label className="block text-sm text-[var(--color-body)]">
          타입
          <select
            className={`${CONTROL_CLASS} mt-2`}
            name="componentType"
            defaultValue={component?.componentType ?? 'frontend'}
          >
            {COMPONENT_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <FieldError messages={state.fieldErrors?.componentType} />
        </label>

        <label className="block text-sm text-[var(--color-body)]">
          중요도
          <Input
            className="mt-2"
            name="criticality"
            type="number"
            min={1}
            max={5}
            defaultValue={component?.criticality ?? 3}
            required
          />
          <FieldError messages={state.fieldErrors?.criticality} />
        </label>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <label className="block text-sm text-[var(--color-body)]">
          Framework
          <Input
            className="mt-2"
            name="framework"
            defaultValue={component?.framework ?? ''}
            maxLength={50}
          />
          <FieldError messages={state.fieldErrors?.framework} />
        </label>

        <label className="block text-sm text-[var(--color-body)]">
          Runtime
          <Input
            className="mt-2"
            name="runtime"
            defaultValue={component?.runtime ?? ''}
            maxLength={50}
          />
          <FieldError messages={state.fieldErrors?.runtime} />
        </label>

        <label className="block text-sm text-[var(--color-body)]">
          Language
          <Input
            className="mt-2"
            name="language"
            defaultValue={component?.language ?? ''}
            maxLength={50}
          />
          <FieldError messages={state.fieldErrors?.language} />
        </label>
      </div>

      {state.message ? (
        <p
          role="status"
          className={`text-sm ${
            state.status === 'success' ? 'text-[var(--color-success)]' : 'text-[var(--color-error)]'
          }`}
        >
          {state.message}
        </p>
      ) : null}

      <Button variant="primary" type="submit" disabled={pending}>
        {pending ? '저장 중…' : component ? '변경사항 저장' : '구성요소 등록'}
      </Button>
    </form>
  );
}
