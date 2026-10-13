"use client";

// A single-choice control (radio group semantics). Settings' other segmented
// controls (Appearance, Week Start, a day's availability) share its sizes:
// 44px segments, 14px labels, a 3px inset and gap.
export default function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  disabled = false,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex bg-slate-800 rounded-xl p-[3px] gap-[3px]">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => { if (!active) onChange(o.value); }}
            className={`flex-1 min-h-11 px-2.5 rounded-[9px] text-sm font-semibold cursor-pointer transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              active ? "bg-slate-600 text-slate-50 shadow ring-1 ring-inset ring-slate-500" : "bg-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
