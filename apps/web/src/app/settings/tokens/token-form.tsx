'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import {
  issueRegistrationToken,
  type TokenActionState,
} from '../../../actions/tokens';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';

const INITIAL_STATE: TokenActionState = { status: 'idle' };

type CopyStatus = 'idle' | 'copied' | 'error';

type CopyState = {
  rawToken?: string;
  status: CopyStatus;
};

const COPY_LABELS: Record<CopyStatus, string> = {
  idle: '복사',
  copied: '복사됨',
  error: '복사 실패',
};

async function issueTokenAction(
  _previousState: TokenActionState,
  formData: FormData,
): Promise<TokenActionState> {
  return issueRegistrationToken(formData);
}

export function RawTokenNotice({ rawToken }: { rawToken?: string }) {
  const [copyState, setCopyState] = useState<CopyState>({
    rawToken,
    status: 'idle',
  });
  const copyAttempt = useRef(0);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  useEffect(() => {
    copyAttempt.current += 1;
    if (resetTimer.current !== undefined) {
      clearTimeout(resetTimer.current);
      resetTimer.current = undefined;
    }
    setCopyState((currentState) =>
      currentState.rawToken === rawToken && currentState.status === 'idle'
        ? currentState
        : { rawToken, status: 'idle' },
    );

    return () => {
      copyAttempt.current += 1;
      if (resetTimer.current !== undefined) {
        clearTimeout(resetTimer.current);
        resetTimer.current = undefined;
      }
    };
  }, [rawToken]);

  if (!rawToken) {
    return null;
  }
  const token = rawToken;
  const copyStatus =
    copyState.rawToken === token ? copyState.status : 'idle';

  async function copyRawToken() {
    if (resetTimer.current !== undefined) {
      clearTimeout(resetTimer.current);
      resetTimer.current = undefined;
    }
    const attempt = ++copyAttempt.current;

    if (!navigator.clipboard) {
      setCopyState({ rawToken: token, status: 'error' });
      return;
    }

    try {
      await navigator.clipboard.writeText(token);
      if (attempt !== copyAttempt.current) {
        return;
      }
      setCopyState({ rawToken: token, status: 'copied' });
      resetTimer.current = setTimeout(() => {
        if (attempt !== copyAttempt.current) {
          return;
        }
        setCopyState({ rawToken: token, status: 'idle' });
        resetTimer.current = undefined;
      }, 2_000);
    } catch {
      if (attempt === copyAttempt.current) {
        setCopyState({ rawToken: token, status: 'error' });
      }
    }
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--caution)] bg-[var(--paper)] p-4">
      <p className="text-sm font-medium text-[var(--caution)]">
        원문은 지금 한 번만 표시됩니다. 안전한 곳에 보관하세요.
      </p>
      <div className="mt-3 flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all font-mono text-sm text-[var(--line)]">
          {rawToken}
        </code>
        <Button onClick={copyRawToken}>
          <span aria-live="polite">{COPY_LABELS[copyStatus]}</span>
        </Button>
      </div>
    </div>
  );
}

export function TokenForm() {
  const [state, formAction, pending] = useActionState(
    issueTokenAction,
    INITIAL_STATE,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span className="text-[var(--annotation)]">저장소 제한</span>
          <Input
            name="repositoryConstraint"
            placeholder="owner/repository"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-[var(--annotation)]">프로젝트 slug 제한</span>
          <Input name="projectSlugConstraint" placeholder="deployhub" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-[var(--annotation)]">만료(시간)</span>
          <Input
            name="expiresInHours"
            type="number"
            min="1"
            max="720"
            defaultValue="24"
            required
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-[var(--annotation)]">최대 사용 횟수</span>
          <Input
            name="maxUses"
            type="number"
            min="1"
            max="100"
            defaultValue="1"
            required
          />
        </label>
      </div>
      <Button type="submit" variant="primary" disabled={pending}>
        {pending ? '발급 중…' : '등록 토큰 발급'}
      </Button>
      {state.message ? (
        <p
          className={`text-sm ${
            state.status === 'error'
              ? 'text-[var(--fault)]'
              : 'text-[var(--confirm)]'
          }`}
        >
          {state.message}
        </p>
      ) : null}
      <RawTokenNotice rawToken={state.rawToken} />
    </form>
  );
}
