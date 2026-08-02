export type SnapshotErrorCode =
  | 'timeout'
  | 'blocked_target'
  | 'navigation_failed'
  | 'render_failed'
  | 'image_too_large';

export const SNAPSHOT_ERROR_MESSAGES: Readonly<Record<SnapshotErrorCode, string>> = {
  timeout: 'The capture timed out.',
  blocked_target: 'The capture target is not allowed.',
  navigation_failed: 'The page could not be loaded.',
  render_failed: 'The page could not be rendered.',
  image_too_large: 'The captured image is too large.',
};

export class SnapshotCaptureError extends Error {
  readonly code: SnapshotErrorCode;

  constructor(code: SnapshotErrorCode) {
    super(SNAPSHOT_ERROR_MESSAGES[code]);
    this.name = 'SnapshotCaptureError';
    this.code = code;
  }
}
