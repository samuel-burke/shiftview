"use client";

import { useEffect, useRef, useState } from "react";
import {
  limitsFromColumns,
  MAX_WEEKLY_HOURS,
  resolveEmployeeLimits,
  type EmployeeLimitColumns,
  type EmploymentType,
  type SchedulingRules,
} from "@/lib/scheduling-rules";
import SegmentedControl from "./SegmentedControl";
import SaveStatusText, { type SaveStatus } from "./SaveStatusText";
import ShiftPreferencesSection from "./ShiftPreferencesSection";

// Manager-only, under each employee in Settings → Team: employment type and
// weekly limits for the Planner's Auto-schedule, plus the employee's shift
// preferences. Blank limits fall back to the org default for the type
// (Settings → Scheduling Rules).

type TypeChoice = EmploymentType | "unset";

function fmtHours(minutes: number): string {
  const h = minutes / 60;
  return Number.isInteger(h) ? String(h) : h.toFixed(1);
}

function parseHours(text: string): number | null | "invalid" {
  if (text.trim() === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0 || n > MAX_WEEKLY_HOURS || !Number.isInteger(n * 2)) return "invalid";
  return n;
}

export default function EmployeeSchedulingRow({
  employee,
  rules,
  firstDayOfWeek,
  onSaved,
}: {
  employee: EmployeeLimitColumns & { id: number; name: string };
  rules: SchedulingRules;
  firstDayOfWeek: number;
  onSaved: (fields: EmployeeLimitColumns) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [type, setType] = useState<TypeChoice>(employee.employment_type ?? "unset");
  const [minText, setMinText] = useState(employee.min_weekly_hours == null ? "" : String(employee.min_weekly_hours));
  const [maxText, setMaxText] = useState(employee.max_weekly_hours == null ? "" : String(employee.max_weekly_hours));
  const [maxDays, setMaxDays] = useState<string>(employee.max_days_per_week == null ? "" : String(employee.max_days_per_week));
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (statusTimer.current) clearTimeout(statusTimer.current); }, []);

  const savedLimits = limitsFromColumns(employee, rules);
  // Placeholders show what a blank field means for the selected type.
  const typeDefaults = resolveEmployeeLimits({ employmentType: type === "unset" ? null : type }, rules);

  const summary = savedLimits.typeSet
    ? `${savedLimits.type === "full_time" ? "Full-time" : "Part-time"} · ${fmtHours(savedLimits.minMinutes)}–${fmtHours(savedLimits.maxMinutes)} h · up to ${savedLimits.maxDays} days`
    : "Employment type not set";

  async function save() {
    const min = parseHours(minText);
    const max = parseHours(maxText);
    if (min === "invalid" || max === "invalid") {
      setProblem(`Hours must be between 0 and ${MAX_WEEKLY_HOURS}, in whole or half hours.`);
      return;
    }
    if (min !== null && max !== null && min > max) {
      setProblem("The minimum can't be more than the maximum.");
      return;
    }
    setProblem(null);
    const fields: EmployeeLimitColumns = {
      employment_type: type === "unset" ? null : type,
      min_weekly_hours: min,
      max_weekly_hours: max,
      max_days_per_week: maxDays === "" ? null : Number(maxDays),
    };
    setStatus("saving");
    const res = await fetch("/api/employees", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: employee.id,
        employmentType: fields.employment_type,
        minWeeklyHours: fields.min_weekly_hours,
        maxWeeklyHours: fields.max_weekly_hours,
        maxDaysPerWeek: fields.max_days_per_week,
      }),
    }).catch(() => null);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    if (res?.ok) {
      onSaved(fields);
      setStatus("saved");
      statusTimer.current = setTimeout(() => setStatus("idle"), 2000);
    } else {
      const body = await res?.json().catch(() => null);
      setProblem(typeof body?.error === "string" ? body.error : null);
      setStatus("error");
      statusTimer.current = setTimeout(() => setStatus("idle"), 4000);
    }
  }

  const inputClass =
    "w-16 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 text-right tabular-nums placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/70";

  return (
    <div data-testid={`employee-scheduling-${employee.id}`} className="px-4 pb-3 pt-0">
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={`Scheduling for ${employee.name}`}
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-400 cursor-pointer bg-transparent border-none transition-colors py-2 -my-2 text-left"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        <span>Scheduling</span>
        <span aria-hidden="true">·</span>
        <span className={savedLimits.typeSet ? "text-slate-400" : "text-amber-400"}>{summary}</span>
      </button>

      {expanded && (
        <div className="mt-3 pl-1 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold text-slate-300">Employment</div>
            <SegmentedControl
              ariaLabel={`Employment type for ${employee.name}`}
              value={type}
              onChange={setType}
              options={[
                { value: "unset", label: "Not set" },
                { value: "full_time", label: "Full-time" },
                { value: "part_time", label: "Part-time" },
              ]}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-semibold text-slate-300">Weekly hours</div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={MAX_WEEKLY_HOURS}
                step={0.5}
                aria-label={`Minimum weekly hours for ${employee.name}`}
                placeholder={fmtHours(typeDefaults.minMinutes)}
                value={minText}
                onChange={(e) => setMinText(e.target.value)}
                className={inputClass}
              />
              <span className="text-xs text-slate-500">–</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={MAX_WEEKLY_HOURS}
                step={0.5}
                aria-label={`Maximum weekly hours for ${employee.name}`}
                placeholder={fmtHours(typeDefaults.maxMinutes)}
                value={maxText}
                onChange={(e) => setMaxText(e.target.value)}
                className={inputClass}
              />
              <span className="text-xs text-slate-500">h</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-semibold text-slate-300">Most days per week</div>
            <select
              aria-label={`Most days per week for ${employee.name}`}
              value={maxDays}
              onChange={(e) => setMaxDays(e.target.value)}
              className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500/70 cursor-pointer"
            >
              <option value="">Default ({typeDefaults.maxDays})</option>
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>

          <div className="text-[11px] text-slate-500 -mt-2">Blank fields use the {type === "full_time" ? "full-time" : "part-time"} default from Scheduling Rules.</div>

          {problem && <div role="alert" className="text-xs text-red-400">{problem}</div>}

          <div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={save}
                disabled={status === "saving"}
                aria-busy={status === "saving"}
                className="text-xs font-semibold px-4 py-2.5 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Save Limits
              </button>
            </div>
            <SaveStatusText status={status} testId={`employee-scheduling-status-${employee.id}`} />
          </div>

          <div className="pt-4 border-t border-slate-800/60">
            <div className="text-xs font-semibold text-slate-300 mb-3">Shift preferences</div>
            <ShiftPreferencesSection
              employeeId={employee.id}
              firstDayOfWeek={firstDayOfWeek}
              employeeName={employee.name}
              embedded
            />
          </div>
        </div>
      )}
    </div>
  );
}
