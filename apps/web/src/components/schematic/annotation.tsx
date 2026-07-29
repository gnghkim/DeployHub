export function Annotation({
  value,
  drift = false,
}: {
  value: string | null;
  drift?: boolean;
}) {
  if (value === null) {
    return (
      <span className="font-mono text-xs text-[var(--absent)]">
        <span aria-hidden="true">┆ </span>
        <span className="sr-only">관측되지 않음</span>
        <span aria-hidden="true">—</span>
      </span>
    );
  }

  return (
    <span className="font-mono text-xs text-[var(--annotation)]">
      <span aria-hidden="true">┆ </span>
      <span className="sr-only">관측</span>
      {drift ? (
        <>
          <span aria-hidden="true">≠ </span>
          <span className="sr-only">선언과 다름</span>
        </>
      ) : null}
      {value}
    </span>
  );
}
