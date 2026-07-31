export const DISPLAY_TIME_ZONE = 'Asia/Seoul';

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: DISPLAY_TIME_ZONE,
});

export function formatDateTime(value: Date): string {
  return DATE_TIME_FORMAT.format(value);
}
