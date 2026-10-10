// Text that changes with state ("Save" → "Saving…") without changing size:
// every label sits in the same grid cell and only the active one is visible,
// so the element is always as wide as its widest label. The hidden ones are
// invisible to assistive tech too. Each label lays out its own parts (text
// and an icon) like the buttons around it: centered, with a gap-2 between.
export default function StableLabel({
  labels,
  active,
  className = "",
}: {
  labels: readonly React.ReactNode[];
  active: number;
  className?: string;
}) {
  return (
    <span className={`inline-grid justify-items-center ${className}`}>
      {labels.map((label, i) => (
        <span
          key={i}
          className={`col-start-1 row-start-1 flex items-center justify-center gap-2 ${i === active ? "" : "invisible"}`}
          aria-hidden={i === active ? undefined : true}
        >
          {label}
        </span>
      ))}
    </span>
  );
}
