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
// weekly limits for Auto-schedule, plus the employee's shift
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
    "w-0 flex-1 min-w-0 bg-fill border border-field rounded-lg px-2 py-1.5 text-xs text-fg text-right tabular-nums placeholder:text-fg-subtle focus:outline-none focus:border-accent";
  // The hours and the days fill one 160px column, so the two rows' controls
  // line up and the select is as wide as the hours beside it.
  const controlColumn = "w-40 shrink-0 flex items-center gap-2";

  return (
    <div data-testid={`employee-scheduling-${employee.id}`} className="px-4 pb-3 pt-0">
      <button
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={`Scheduling for ${employee.name}`}
        className="flex items-center gap-1.5 text-xs text-fg-subtle hover:text-fg-muted cursor-pointer bg-transparent border-none transition-colors py-2 -my-2 text-left"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
        <span>Scheduling</span>
        <span aria-hidden="true">·</span>
        <span className={savedLimits.typeSet ? "text-fg-muted" : "text-warning-fg"}>{summary}</span>
      </button>

      {expanded && (
        <div className="mt-3 pl-1 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="text-xs font-semibold text-fg-secondary">Employment</div>
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
            <div className="text-xs font-semibold text-fg-secondary">Weekly hours</div>
            <div className={controlColumn}>
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
              <span className="shrink-0 text-xs text-fg-subtle">–</span>
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
              <span className="shrink-0 text-xs text-fg-subtle">h</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-semibold text-fg-secondary">Most days per week</div>
            <div className={controlColumn}>
              <select
                aria-label={`Most days per week for ${employee.name}`}
                value={maxDays}
                onChange={(e) => setMaxDays(e.target.value)}
                className="w-full min-w-0 bg-fill border border-field rounded-lg px-2 py-1.5 text-xs text-fg focus:outline-none focus:border-accent cursor-pointer"
              >
                <option value="">Default ({typeDefaults.maxDays})</option>
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="text-[11px] text-fg-subtle -mt-2">Blank fields use the {type === "full_time" ? "full-time" : "part-time"} default from Scheduling Rules.</div>

          {/* The form's problem or its save status, beside Save: neither needs
              a line of its own, so the form ends at its button. */}
          <div className="flex items-center gap-3 min-h-10">
            <div className="flex-1 min-w-0">
              {problem && <div role="alert" className="text-xs leading-4 text-danger-fg">{problem}</div>}
              <SaveStatusText status={status} testId={`employee-scheduling-status-${employee.id}`} />
            </div>
            <button
              type="button"
              onClick={save}
              disabled={status === "saving"}
              aria-busy={status === "saving"}
              className="shrink-0 h-10 text-xs font-semibold px-4 rounded-lg bg-accent/20 text-accent-fg-strong border border-accent/30 hover:bg-accent/30 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Save Limits
            </button>
          </div>

          <div className="pt-4 border-t border-line/60">
            <div className="text-xs font-semibold text-fg-secondary mb-3">Shift preferences</div>
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
