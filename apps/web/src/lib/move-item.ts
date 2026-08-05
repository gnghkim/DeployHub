/**
 * 배열에서 한 항목을 다른 위치로 옮긴 새 배열을 돌려준다.
 * 목표 위치는 배열 범위로 잘라 낸다. 드래그 중 포인터가 목록 밖으로
 * 나가도 양 끝에 붙기만 하고 항목이 사라지지 않게 하기 위해서다.
 */
export function moveItem(
  items: readonly string[],
  from: number,
  to: number,
): string[] {
  const next = [...items];
  if (from < 0 || from >= next.length) return next;

  const target = Math.max(0, Math.min(to, next.length - 1));
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return next;
  next.splice(target, 0, moved);
  return next;
}
