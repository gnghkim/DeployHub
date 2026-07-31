export const DISPLAY_TIME_ZONE = 'Asia/Seoul';

// CLDR 의 한국어 day period 가 오전/오후 대신 AM/PM 을 내므로 24시간제로 표시한다.
const DATE_TIME_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: DISPLAY_TIME_ZONE,
  hour12: false,
});

export function formatDateTime(value: Date): string {
  return DATE_TIME_FORMAT.format(value);
}
