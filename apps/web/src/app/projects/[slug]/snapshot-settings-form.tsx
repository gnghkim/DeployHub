'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';

const FALLBACK_ERROR = '스냅샷 설정을 저장하지 못했습니다. 다시 시도해 주세요.';

async function responseError(response: Response): Promise<string> {
  if (response.headers.get('content-type')?.includes('application/json')) {
    try {
      const body = await response.json() as { error?: unknown };
      if (typeof body.error === 'string' && body.error.length <= 100) {
        return body.error;
      }
    } catch {
      // A malformed error response should fall back to a stable message.
    }
  }
  return FALLBACK_ERROR;
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
  const [automatic, setAutomatic] = useState(mode === 'automatic');
  const [url, setUrl] = useState(snapshotUrl ?? '');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setMessage('');
    setIsError(false);
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(slug)}/snapshot/settings`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode: automatic ? 'automatic' : 'disabled',
            url: url.trim() || null,
          }),
        },
      );
      if (!response.ok) {
        setIsError(true);
        setMessage(await responseError(response));
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
    <form className="space-y-5" onSubmit={submit}>
      <label className="block text-sm text-[var(--line-mute)]">
        대표 URL
        <Input
          className="mt-2"
          name="snapshotUrl"
          type="url"
          value={url}
          onChange={(event) => setUrl(event.currentTarget.value)}
          placeholder="https://example.com/"
          maxLength={2_048}
          required={automatic}
          disabled={pending}
        />
      </label>

      <label className="flex items-start gap-3 text-sm text-[var(--line-mute)]">
        <input
          className="mt-0.5 size-4 accent-[var(--accent)]"
          name="automatic"
          type="checkbox"
          checked={automatic}
          onChange={(event) => setAutomatic(event.currentTarget.checked)}
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
