"use client";

import { useState } from "react";
import { validateOnboardingLabel, onboardingProgress } from "../lib/onboarding";

export type OnboardingItem = { id: number; label: string; done: boolean };

// New-hire onboarding checklist. Managers add/check/remove items; employees see
// a read-only view of their progress. Presentational — the parent persists via
// /api/onboarding.
export default function OnboardingChecklist({
  items,
  canManage = false,
  onAdd,
  onToggle,
  onDelete,
}: {
  items: OnboardingItem[];
  canManage?: boolean;
  onAdd?: (label: string) => Promise<void> | void;
  onToggle?: (id: number, done: boolean) => Promise<void> | void;
  onDelete?: (id: number) => Promise<void> | void;
}) {
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const progress = onboardingProgress(items);

  const add = () => {
    const check = validateOnboardingLabel(label);
    if (!check.valid) {
      setError(check.error);
      return;
    }
    setError(null);
    setLabel("");
    onAdd?.(check.value);
  };

  return (
    <div data-testid="onboarding-checklist" className="flex flex-col gap-2">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">Onboarding</div>
        <div
          data-testid="onboarding-progress"
          className={`text-xs font-semibold ${progress.complete ? "text-emerald-400" : "text-slate-400"}`}
        >
          {progress.done}/{progress.total} · {progress.pct}%
        </div>
      </div>

      {items.length === 0 ? (
        <div className="text-center py-4 text-slate-400 text-sm">No checklist items</div>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((it) => (
            <li
              key={it.id}
              data-testid={`onboarding-item-${it.id}`}
              className="flex items-center justify-between rounded-xl bg-card border border-slate-800/60 px-3 py-2"
            >
              <label className="flex items-center gap-2 text-sm text-slate-200">
                <input
                  type="checkbox"
                  checked={it.done}
                  disabled={!canManage}
                  onChange={(e) => onToggle?.(it.id, e.target.checked)}
                  aria-label={it.label}
                />
                <span className={it.done ? "line-through text-slate-500" : ""}>{it.label}</span>
              </label>
              {canManage && onDelete && (
                <button
                  onClick={() => onDelete(it.id)}
                  aria-label={`Delete ${it.label}`}
                  className="text-[11px] font-semibold text-red-400 cursor-pointer bg-transparent border-none hover:text-red-300"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              aria-label="New onboarding task"
              placeholder="Add a task…"
              className="flex-1 rounded-xl bg-card border border-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-slate-600"
            />
            <button
              onClick={add}
              className="rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 px-4 py-2 text-sm font-bold text-white cursor-pointer border-none hover:brightness-110"
            >
              Add
            </button>
          </div>
          {error && <div role="alert" className="text-xs text-red-400">{error}</div>}
        </div>
      )}
    </div>
  );
}
