'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRef, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { MAX_SNAPSHOT_UPLOAD_BYTES } from '../../../lib/snapshot-constants';

const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const FALLBACK_ERROR = '스냅샷 작업을 완료하지 못했습니다. 다시 시도해 주세요.';

type SnapshotMode = 'disabled' | 'automatic' | 'manual';
type SnapshotSource = 'automatic' | 'manual' | null;
type SnapshotAttemptStatus = 'pending' | 'success' | 'failed' | null;

export type SnapshotPanelProps = {
  slug: string;
  mode: SnapshotMode;
  snapshotUrl: string | null;
  snapshot: {
    hasImage: boolean;
    source: SnapshotSource;
    capturedAt: string | null;
    checksum: string | null;
    lastAttemptAt: string | null;
    lastAttemptStatus: SnapshotAttemptStatus;
    lastError: string | null;
  };
};

function displayTime(value: string): string {
  return `${value.slice(0, 16).replace('T', ' ')} UTC`;
}

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

export function SnapshotPanel({ slug, mode, snapshotUrl, snapshot }: SnapshotPanelProps) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [isError, setIsError] = useState(false);
  const baseEndpoint = `/api/projects/${encodeURIComponent(slug)}/snapshot`;
  const imageEndpoint = snapshot.hasImage && snapshot.checksum
    ? `${baseEndpoint}?checksum=${encodeURIComponent(snapshot.checksum)}`
    : null;

  async function request(
    action: string,
    endpoint: string,
    init: RequestInit,
    successMessage: string,
  ) {
    if (pending !== null) return;
    setPending(action);
    setMessage('');
    setIsError(false);
    try {
      const response = await fetch(endpoint, init);
      if (!response.ok) {
        setIsError(true);
        setMessage(await responseError(response));
        return;
      }
      setMessage(successMessage);
      router.refresh();
    } catch {
      setIsError(true);
      setMessage(FALLBACK_ERROR);
    } finally {
      setPending(null);
    }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setIsError(true);
      setMessage('PNG, JPEG 또는 WebP 이미지를 선택해 주세요.');
      event.currentTarget.value = '';
      return;
    }
    if (file.size > MAX_SNAPSHOT_UPLOAD_BYTES) {
      setIsError(true);
      setMessage('이미지는 5 MB 이하여야 합니다.');
      event.currentTarget.value = '';
      return;
    }
    const body = new FormData();
    body.set('file', file);
    await request('upload', `${baseEndpoint}/upload`, { method: 'POST', body }, '스냅샷을 업로드했습니다.');
    if (fileInput.current) fileInput.current.value = '';
  }

  const uploadLabel = mode === 'manual' ? '이미지 교체' : '이미지 업로드';
  const resumeDescriptionId = `snapshot-resume-unavailable-${slug}`;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-medium text-[var(--line)]">스냅샷</h3>
          <p className="mt-1 text-xs text-[var(--annotation)]">
            자동 캡처는 로그인 없이 볼 수 있는 공개 페이지만 지원합니다. 로그인 후
            화면은 직접 캡처해 업로드해 주세요.
          </p>
        </div>
        {snapshot.lastAttemptStatus === 'pending' ? (
          <span className="rounded-full border border-[var(--rule)] px-2 py-1 text-xs text-[var(--line-mute)]">
            갱신 중
          </span>
        ) : null}
      </div>

      {imageEndpoint ? (
        <div className="mt-5">
          <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--rule)] bg-[var(--canvas)]">
            <Image
              src={imageEndpoint}
              alt="현재 프로젝트 스냅샷"
              width={1440}
              height={900}
              sizes="(max-width: 1024px) 100vw, 70vw"
              className="h-auto w-full object-contain"
              unoptimized
            />
          </div>
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--annotation)]">
            <div className="flex gap-1.5">
              <dt>출처</dt>
              <dd className="text-[var(--line-mute)]">
                {snapshot.source === 'automatic' ? '자동 캡처' : '수동 업로드'}
              </dd>
            </div>
            {snapshot.capturedAt ? (
              <div className="flex gap-1.5">
                <dt>캡처 시각</dt>
                <dd className="text-[var(--line-mute)]">
                  <time dateTime={snapshot.capturedAt}>{displayTime(snapshot.capturedAt)}</time>
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : (
        <p className="mt-5 rounded-[var(--radius-card)] border border-dashed border-[var(--rule)] p-5 text-sm text-[var(--annotation)]">
          등록된 스냅샷이 없습니다.
        </p>
      )}

      {snapshot.lastAttemptStatus === 'failed' ? (
        <p className="mt-4 text-sm text-[var(--fault)]">
          마지막 캡처 실패{snapshot.lastError ? `: ${snapshot.lastError}` : ''}
          {snapshot.lastAttemptAt ? (
            <time className="ml-2 text-xs" dateTime={snapshot.lastAttemptAt}>
              {displayTime(snapshot.lastAttemptAt)}
            </time>
          ) : null}
        </p>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {mode === 'automatic' ? (
          <Button
            variant="primary"
            disabled={pending !== null}
            onClick={() => request(
              'capture',
              `${baseEndpoint}/capture`,
              { method: 'POST' },
              '스냅샷 캡처를 요청했습니다.',
            )}
          >
            {pending === 'capture' ? '요청 중…' : '지금 캡처'}
          </Button>
        ) : null}

        {mode === 'manual' ? (
          <Button
            variant="primary"
            disabled={pending !== null || snapshotUrl === null}
            aria-describedby={snapshotUrl === null ? resumeDescriptionId : undefined}
            onClick={() => request(
              'resume',
              `${baseEndpoint}/resume`,
              { method: 'POST' },
              '자동 캡처를 재개했습니다.',
            )}
          >
            {pending === 'resume' ? '재개 중…' : '자동 캡처 재개'}
          </Button>
        ) : null}

        {mode === 'manual' && snapshotUrl === null ? (
          <p id={resumeDescriptionId} className="w-full text-xs text-[var(--annotation)]">
            자동 캡처를 재개하려면 먼저{' '}
            <Link
              href={`/projects/${slug}/edit`}
              className="font-medium text-[var(--line-mute)] underline underline-offset-2 hover:text-[var(--line)]"
            >
              설정에서 대표 URL을 입력해 주세요
            </Link>
            .
          </p>
        ) : null}

        <label className={`inline-flex h-9 cursor-pointer items-center justify-center rounded-[var(--radius-button)] border border-[var(--rule)] bg-[var(--paper)] px-3 text-sm font-medium text-[var(--line)] transition-colors hover:bg-white/[0.02] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[var(--accent)] ${pending !== null ? 'pointer-events-none opacity-50' : ''}`}>
          {pending === 'upload' ? '업로드 중…' : uploadLabel}
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            disabled={pending !== null}
            onChange={upload}
          />
        </label>
        <span className="text-xs text-[var(--annotation)]">PNG, JPEG, WebP · 최대 5 MB</span>

        {snapshot.hasImage && mode !== 'disabled' ? (
          <Button
            variant="tertiary"
            disabled={pending !== null}
            onClick={() => request(
              'delete',
              baseEndpoint,
              { method: 'DELETE' },
              '스냅샷을 삭제했습니다.',
            )}
          >
            {pending === 'delete' ? '삭제 중…' : '스냅샷 삭제'}
          </Button>
        ) : null}

        {mode === 'disabled' ? (
          <Link
            href={`/projects/${slug}/edit`}
            className="text-sm font-medium text-[var(--line-mute)] hover:text-[var(--line)]"
          >
            설정에서 자동 캡처 사용
          </Link>
        ) : null}
      </div>

      <p
        aria-live="polite"
        className={`mt-3 min-h-5 text-sm ${isError ? 'text-[var(--fault)]' : 'text-[var(--confirm)]'}`}
      >
        {message}
      </p>
    </Card>
  );
}
