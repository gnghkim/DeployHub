'use client';

import { useActionState } from 'react';
import type { ProjectRow } from '@deployhub/db';
import {
  createProject,
  updateProject,
  type ProjectActionState,
} from '../../actions/projects';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';

const INITIAL_STATE: ProjectActionState = { status: 'idle' };
const CONTROL_CLASS =
  'h-9 w-full rounded-[var(--radius-button)] border border-[var(--color-hairline)] bg-[var(--color-surface-elevated)] px-3 text-sm text-[var(--color-ink)] outline-none focus:border-[var(--color-info)]';

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="mt-1 text-xs text-[var(--color-error)]">{messages[0]}</p>;
}

export function ProjectForm({ project }: { project?: ProjectRow }) {
  const action = project ? updateProject.bind(null, project.id) : createProject;
  const [state, formAction, pending] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-5">
      <div className="grid gap-5 md:grid-cols-2">
        <label className="block text-sm text-[var(--color-body)]">
          이름
          <Input
            className="mt-2"
            name="name"
            defaultValue={project?.name}
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
            defaultValue={project?.slug}
            pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            required
          />
          <FieldError messages={state.fieldErrors?.slug} />
        </label>
      </div>

      <label className="block text-sm text-[var(--color-body)]">
        설명
        <textarea
          className={`${CONTROL_CLASS} mt-2 min-h-24 py-2`}
          name="description"
          defaultValue={project?.description ?? ''}
          maxLength={500}
        />
        <FieldError messages={state.fieldErrors?.description} />
      </label>

      <div className="grid gap-5 md:grid-cols-3">
        <label className="block text-sm text-[var(--color-body)]">
          상태
          <select className={`${CONTROL_CLASS} mt-2`} name="status" defaultValue={project?.status ?? 'active'}>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="maintenance">Maintenance</option>
            <option value="archived">Archived</option>
          </select>
          <FieldError messages={state.fieldErrors?.status} />
        </label>

        <label className="block text-sm text-[var(--color-body)]">
          Lifecycle
          <select
            className={`${CONTROL_CLASS} mt-2`}
            name="lifecycle"
            defaultValue={project?.lifecycle ?? 'development'}
          >
            <option value="experimental">Experimental</option>
            <option value="development">Development</option>
            <option value="production">Production</option>
            <option value="deprecated">Deprecated</option>
          </select>
          <FieldError messages={state.fieldErrors?.lifecycle} />
        </label>

        <label className="block text-sm text-[var(--color-body)]">
          중요도
          <Input
            className="mt-2"
            name="importance"
            type="number"
            min={1}
            max={5}
            defaultValue={project?.importance ?? 3}
            required
          />
          <FieldError messages={state.fieldErrors?.importance} />
        </label>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <label className="block text-sm text-[var(--color-body)]">
          담당자
          <Input className="mt-2" name="owner" defaultValue={project?.owner ?? ''} maxLength={100} />
          <FieldError messages={state.fieldErrors?.owner} />
        </label>

        <label className="block text-sm text-[var(--color-body)]">
          저장소
          <Input
            className="mt-2"
            name="repository"
            defaultValue={project?.repository ?? ''}
            placeholder="owner/name"
          />
          <FieldError messages={state.fieldErrors?.repository} />
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
        {pending ? '저장 중…' : project ? '변경사항 저장' : '프로젝트 등록'}
      </Button>
    </form>
  );
}
