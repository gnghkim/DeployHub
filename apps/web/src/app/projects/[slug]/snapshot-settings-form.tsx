'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../components/ui/button';

const FALLBACK_ERROR = '스냅샷 설정을 저장하지 못했습니다. 다시 시도해 주세요.';

const URL_POLICY_ERROR =
  '대표 URL은 사용자 정보와 조각 식별자가 없는 HTTP(S) URL이어야 하며 HTTP는 80, HTTPS는 443 포트만 사용할 수 있습니다.';

type ValidatedUrl =
  | { ok: true; url: string | null }
  | { ok: false; error: string };

export function validateSnapshotUrl(value: string, automatic: boolean): ValidatedUrl {
  if (value.length === 0) {
    return automatic
      ? { ok: false, error: '자동 캡처를 사용하려면 대표 URL을 입력해 주세요.' }
      : { ok: true, url: null };
  }
  if (value.trim() !== value) {
    return { ok: false, error: '대표 URL 앞뒤에 공백을 입력할 수 없습니다.' };
  }
  if (value.length > 2_048) {
    return { ok: false, error: '대표 URL은 2,048자 이하여야 합니다.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, error: URL_POLICY_ERROR };
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    || parsed.hostname.length === 0
  ) {
    return { ok: false, error: URL_POLICY_ERROR };
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    return { ok: false, error: URL_POLICY_ERROR };
  }
  if (parsed.hash.length > 0) {
    return { ok: false, error: '대표 URL에는 조각 식별자(#)를 사용할 수 없습니다.' };
  }
  if (parsed.port.length > 0) {
    const expectedPort = parsed.protocol === 'http:' ? '80' : '443';
    return {
      ok: false,
      error: `${parsed.protocol === 'http:' ? 'HTTP' : 'HTTPS'} URL은 ${expectedPort} 포트만 사용할 수 있습니다.`,
    };
  }
  return { ok: true, url: parsed.toString() };
}

async function isServerUrlValidationError(response: Response): Promise<boolean> {
  if (response.headers.get('content-type')?.includes('application/json')) {
    try {
      const body = await response.json() as { error?: unknown };
      return body.error === 'invalid_settings' || body.error === 'Invalid settings';
    } catch {
      return false;
    }
  }
  return false;
}

export function SnapshotSettingsForm({
  slug,
  mode,
  snapshotUrl,
}: {
  slug: string;
  mode: 'disabled' | 'automatic' | 'manual';
  snapshotUrl: string | null;
}) {
  const router = useRouter();
  const urlInput = useRef<HTMLInputElement>(null);
  const [automatic, setAutomatic] = useState(mode === 'automatic');
  const [url, setUrl] = useState(snapshotUrl ?? '');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const [urlError, setUrlError] = useState('');

  useEffect(() => {
    if (urlError && !pending) urlInput.current?.focus();
  }, [pending, urlError]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const validatedUrl = validateSnapshotUrl(url, automatic);
    if (!validatedUrl.ok) {
      setUrlError(validatedUrl.error);
      setMessage('');
      setIsError(false);
      return;
    }
    setPending(true);
    setMessage('');
    setIsError(false);
    setUrlError('');
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(slug)}/snapshot/settings`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: automatic ? 'automatic' : 'disabled',
            url: validatedUrl.url,
          }),
        },
      );
      if (!response.ok) {
        if (await isServerUrlValidationError(response)) {
          setUrlError(URL_POLICY_ERROR);
          return;
        }
        setIsError(true);
        setMessage(FALLBACK_ERROR);
        return;
      }
      setMessage('스냅샷 설정을 저장했습니다.');
      router.refresh();
    } catch {
      setIsError(true);
      setMessage(FALLBACK_ERROR);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit} noValidate>
      <label className="block text-sm text-[var(--line-mute)]">
        대표 URL
        <input
          ref={urlInput}
          className="mt-2 h-9 w-full rounded-[var(--radius-button)] border border-[var(--rule)] bg-[var(--paper)] px-3 text-sm text-[var(--line)] outline-none placeholder:text-[var(--absent)] focus:border-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-50"
          name="snapshotUrl"
          type="url"
          value={url}
          onChange={(event) => {
            setUrl(event.currentTarget.value);
            setUrlError('');
          }}
          placeholder="https://example.com/"
          maxLength={2_048}
          required={automatic}
          disabled={pending}
          aria-invalid={urlError.length > 0}
          aria-describedby={urlError
            ? 'snapshot-url-help snapshot-url-error'
            : 'snapshot-url-help'}
        />
        <span
          id="snapshot-url-help"
          className="mt-1 block text-xs text-[var(--annotation)]"
        >
          HTTP는 80, HTTPS는 443 포트의 공개 주소만 사용할 수 있습니다.
        </span>
        {urlError ? (
          <span id="snapshot-url-error" className="mt-1 block text-xs text-[var(--fault)]">
            {urlError}
          </span>
        ) : null}
      </label>

      <label className="flex items-start gap-3 text-sm text-[var(--line-mute)]">
        <input
          className="mt-0.5 size-4 accent-[var(--accent)]"
          name="automatic"
          type="checkbox"
          checked={automatic}
          onChange={(event) => {
            setAutomatic(event.currentTarget.checked);
            setUrlError('');
          }}
          disabled={pending}
        />
        <span>
          <span className="block font-medium text-[var(--line)]">
            운영 배포 성공 후 자동 캡처
          </span>
          <span className="mt-1 block text-xs text-[var(--annotation)]">
            자동 캡처는 로그인 없이 볼 수 있는 공개 페이지만 지원합니다. 로그인 후
            화면은 직접 캡처해 업로드해 주세요.
          </span>
        </span>
      </label>

      <p
        aria-live="polite"
        className={`min-h-5 text-sm ${isError ? 'text-[var(--fault)]' : 'text-[var(--confirm)]'}`}
      >
        {message}
      </p>

      <Button variant="primary" type="submit" disabled={pending}>
        {pending ? '저장 중…' : '스냅샷 설정 저장'}
      </Button>
    </form>
  );
}
