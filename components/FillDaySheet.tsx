"use client";
import { useState } from "react";

type Employee = { id: number; name: string };

type Props = {
  open: boolean;
  onClose: () => void;
  employees: Employee[];
  scheduledEmployeeIds: Set<number>;
  defaultStart: number;
  defaultEnd: number;
  dateLabel: string;
  onSubmit: (employeeIds: number[], startMinutes: number, endMinutes: number) => Promise<void>;
};

function minutesToTime(m: number): string {
  return `${Math.floor(m / 60).toString().padStart(2, "0")}:${(m % 60).toString().padStart(2, "0")}`;
}
function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export default function FillDaySheet({ open, onClose, employees, scheduledEmployeeIds, defaultStart, defaultEnd, dateLabel, onSubmit }: Props) {
  const unscheduled = employees.filter(e => !scheduledEmployeeIds.has(e.id));
  const [selected, setSelected] = useState<Set<number>>(new Set(unscheduled.map(e => e.id)));
  const [startVal, setStartVal] = useState(minutesToTime(defaultStart));
  const [endVal, setEndVal] = useState(minutesToTime(defaultEnd));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    if (selected.size === 0) { setError("Select at least one employee"); return; }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(Array.from(selected), timeToMinutes(startVal), timeToMinutes(endVal));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div onClick={onClose} className={`fixed inset-0 bg-black/60 z-40 transition-opacity ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`} />
      <div className={`fixed bottom-0 left-0 right-0 z-50 bg-slate-900 border-t border-slate-800 rounded-t-3xl max-w-[480px] mx-auto transition-transform duration-300 ${open ? "translate-y-0" : "translate-y-full"}`}>
        <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-slate-700" /></div>
        <div className="px-6 pt-2 pb-8">
          <div className="flex items-center justify-between mb-4">
            <span className="text-base font-bold text-slate-100">Fill Day · {dateLabel}</span>
            <button onClick={onClose} className="size-8 rounded-full bg-slate-800 text-slate-400 cursor-pointer flex items-center justify-center">✕</button>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            {[{ label: "Start", val: startVal, set: setStartVal }, { label: "End", val: endVal, set: setEndVal }].map(({ label, val, set }) => (
              <div key={label}>
                <div className="text-[11px] text-slate-400 uppercase tracking-[0.08em] mb-1.5">{label}</div>
                <input type="time" value={val} onChange={e => set(e.target.value)}
                  className="w-full bg-card border border-slate-700 rounded-[10px] px-3 py-2.5 text-slate-100 text-sm [color-scheme:dark]" />
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1 mb-4 max-h-48 overflow-y-auto">
            {employees.map(emp => {
              const already = scheduledEmployeeIds.has(emp.id);
              return (
                <label key={emp.id} className={`flex items-center gap-3 px-2 py-2 rounded-xl cursor-pointer ${already ? "opacity-40" : "hover:bg-slate-800"}`}>
                  <input type="checkbox" checked={already || selected.has(emp.id)} disabled={already} onChange={() => !already && toggle(emp.id)}
                    className="size-4 rounded accent-blue-500" />
                  <span className="text-sm text-slate-100">{emp.name}</span>
                  {already && <span className="text-xs text-slate-500 ml-auto">Already scheduled</span>}
                </label>
              );
            })}
          </div>

          {error && <div className="text-xs text-red-400 text-center mb-3">{error}</div>}
          <button onClick={handleSubmit} disabled={submitting || selected.size === 0}
            className="w-full py-[14px] rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 border-none text-white font-bold text-sm cursor-pointer disabled:opacity-50">
            {submitting ? "Scheduling…" : `Schedule ${selected.size} Employee${selected.size !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </>
  );
}
