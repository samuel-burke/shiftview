"use client";

import { useState } from "react";
import { SHIFT_TYPES } from "../lib/shift-preferences";
import { SHIFT_COLORS, type ShiftType } from "../data/types";

const LABELS: Record<ShiftType, string> = { opener: "Opener", mid: "Mid", closer: "Closer" };

// Toggle chips for an employee's preferred shift types. Presentational — the
// parent persists via PUT /api/employees/shift-preferences. Selecting none means
// "no preference".
export default function ShiftPreferencesPicker({
  value,
  canEdit = true,
  onChange,
}: {
  value: ShiftType[];
  canEdit?: boolean;
  onChange?: (next: ShiftType[]) => Promise<void> | void;
}) {
  const [selected, setSelected] = useState<ShiftType[]>(value);

  const toggle = (t: ShiftType) => {
    if (!canEdit) return;
    const next = selected.includes(t) ? selected.filter((x) => x !== t) : [...selected, t];
    // Keep canonical order.
    const ordered = SHIFT_TYPES.filter((x) => next.includes(x));
    setSelected(ordered);
    onChange?.(ordered);
  };

  return (
    <div data-testid="shift-preferences" className="flex flex-col gap-2">
      <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">Preferred shifts</div>
      <div className="flex gap-2">
        {SHIFT_TYPES.map((t) => {
          const on = selected.includes(t);
          return (
            <button
              key={t}
              type="button"
              aria-pressed={on}
              aria-label={LABELS[t]}
              disabled={!canEdit}
              onClick={() => toggle(t)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                on ? "text-white border-transparent" : "text-slate-300 border-slate-700 bg-card"
              } ${canEdit ? "cursor-pointer" : "cursor-default"}`}
              style={on ? { background: SHIFT_COLORS[t] } : undefined}
            >
              {LABELS[t]}
            </button>
          );
        })}
      </div>
      {selected.length === 0 && (
        <div className="text-[11px] text-slate-500">No preference — open to any shift</div>
      )}
    </div>
  );
}
