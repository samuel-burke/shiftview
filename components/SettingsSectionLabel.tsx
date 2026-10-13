// A Settings section's name, with the right end of its line kept for the
// section's save status, so the status never adds a line to the card.
export default function SettingsSectionLabel({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 mb-2 px-1">
      <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">{label}</div>
      {children}
    </div>
  );
}
