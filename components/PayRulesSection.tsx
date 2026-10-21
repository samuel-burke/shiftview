"use client";

import { useEffect, useRef, useState } from "react";
import SaveStatusText, { type SaveStatus } from "./SaveStatusText";
import SettingsSectionLabel from "./SettingsSectionLabel";
import {
  DEFAULT_PAY_RULES,
  ROUNDING_OPTIONS,
  type OvertimeRule,
  type PayRules,
  type RoundingMinutes,
} from "@/lib/pay-rules";

// Settings → Pay Rules (managers): how payroll turns worked time into
// regular, overtime and double-time hours. Every default is what payroll did
// before these settings existed.

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const OVERTIME_RULE_OPTIONS: { value: OvertimeRule; label: string; desc: string }[] = [
  { value: "federal", label: "Federal (FLSA)", desc: "Overtime after 40 hours in a workweek." },
  {
    value: "california",
    label: "California",
    desc: "Overtime after 8 h a day and 40 h a week; double time after 12 h a day. On the 7th consecutive day worked in a workweek, the first 8 h are overtime and the rest double time.",
  },
  { value: "alaska", label: "Alaska", desc: "Overtime after 8 h a day and 40 h a week." },
  {
    value: "nevada",
    label: "Nevada",
    desc: "Overtime after 40 h a week. Daily overtime (after 8 h) applies only to employees paid under 1.5× the Nevada minimum wage; turn it on below if that's everyone hourly.",
  },
  { value: "colorado", label: "Colorado", desc: "Overtime after 12 h a day and 40 h a week." },
];

const ROUNDING_LABELS: Record<RoundingMinutes, string> = {
  0: "Off — exact time",
  5: "Nearest 5 minutes",
  6: "Nearest 6 minutes (tenth of an hour)",
  15: "Nearest 15 minutes (7-minute rule)",
};

export default function PayRulesSection({
  rules,
  onSaved,
}: {
  rules: PayRules;
  onSaved: (rules: PayRules) => void;
}) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  // A workweek change waits for the manager to confirm it.
  const [pendingWeekStart, setPendingWeekStart] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function save(patch: Partial<PayRules>) {
    const before = rules;
    onSaved({ ...rules, ...patch });
    setStatus("saving");
    setProblem(null);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payRules: patch }),
    }).catch(() => null);
    if (timer.current) clearTimeout(timer.current);
    if (res?.ok) {
      setStatus("saved");
      timer.current = setTimeout(() => setStatus("idle"), 2000);
    } else {
      onSaved(before);
      const body = await res?.json().catch(() => null);
      setProblem(typeof body?.error === "string" ? body.error : "Couldn't save. Try again.");
      setStatus("error");
      timer.current = setTimeout(() => setStatus("idle"), 4000);
    }
  }

  const rule = OVERTIME_RULE_OPTIONS.find((o) => o.value === rules.overtimeRule) ?? OVERTIME_RULE_OPTIONS[0];
  const selectClass =
    "w-full bg-fill border border-field rounded-xl px-3 py-2.5 text-sm text-fg cursor-pointer focus:outline-none focus:border-accent transition-colors";

  return (
    <section data-testid="pay-rules">
      <SettingsSectionLabel label="Pay Rules">
        <SaveStatusText status={status} testId="pay-rules-status" />
      </SettingsSectionLabel>
      <div className="bg-card rounded-2xl border border-line/60 px-4 py-4 space-y-4">
        {/* Overtime rule */}
        <div>
          <label htmlFor="overtime-rule" className="text-sm font-semibold text-fg-body block mb-1.5">Overtime rule</label>
          <select
            id="overtime-rule"
            value={rules.overtimeRule}
            onChange={(e) => save({ overtimeRule: e.target.value as OvertimeRule })}
            className={selectClass}
          >
            {OVERTIME_RULE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}{o.value === DEFAULT_PAY_RULES.overtimeRule ? " (default)" : ""}</option>
            ))}
          </select>
          <div className="text-xs text-fg-subtle mt-1.5" data-testid="overtime-rule-desc">{rule.desc}</div>
          <div className="text-xs text-fg-subtle mt-1">
            Daily limits count each calendar day in the store&apos;s timezone; a shift past midnight is split there.
            Exempt (salaried) employees, set under Team, get no overtime.
          </div>
        </div>

        {rules.overtimeRule === "nevada" && (
          <div className="flex items-center justify-between gap-3 pt-4 border-t border-line/60">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-fg-body">Nevada daily overtime</div>
              <div className="text-xs text-fg-subtle mt-0.5">Over 8 h in a day. Only for employees paid under 1.5× minimum wage.</div>
            </div>
            <button
              role="switch"
              aria-label="Nevada daily overtime"
              aria-checked={rules.nevadaDailyOvertime}
              onClick={() => save({ nevadaDailyOvertime: !rules.nevadaDailyOvertime })}
              className={`relative w-11 h-6 rounded-full transition-colors cursor-pointer shrink-0 ${
                rules.nevadaDailyOvertime ? "bg-accent" : "bg-fill-strong ring-1 ring-inset ring-field"
              }`}
            >
              <span className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-on-accent shadow transition-transform ${rules.nevadaDailyOvertime ? "translate-x-5" : "translate-x-0"}`} />
            </button>
          </div>
        )}

        {/* Payroll workweek */}
        <div className="pt-4 border-t border-line/60">
          <label htmlFor="payroll-week-start" className="text-sm font-semibold text-fg-body block mb-1.5">Payroll workweek starts</label>
          <select
            id="payroll-week-start"
            value={pendingWeekStart ?? rules.workweekStartDay}
            onChange={(e) => {
              const v = Number(e.target.value);
              setPendingWeekStart(v === rules.workweekStartDay ? null : v);
            }}
            className={selectClass}
          >
            {DAY_NAMES.map((name, i) => (
              <option key={i} value={i}>{name}{i === DEFAULT_PAY_RULES.workweekStartDay ? " (default)" : ""}</option>
            ))}
          </select>
          <div className="text-xs text-warning-fg mt-1.5" data-testid="workweek-warning">
            Overtime is counted over this fixed 7-day workweek. Change it rarely, only for a lasting business reason, and
            never to avoid paying overtime: the law requires a fixed workweek. It doesn&apos;t have to match the schedule&apos;s week start.
          </div>
          {pendingWeekStart !== null && (
            <div role="alert" className="mt-2 px-3 py-2.5 bg-warning/10 border border-warning/25 rounded-xl text-xs text-warning-fg-strong space-y-2">
              <div>
                Start the payroll workweek on {DAY_NAMES[pendingWeekStart]} instead of {DAY_NAMES[rules.workweekStartDay]}?
                Past and future overtime will be counted over the new weeks.
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { const v = pendingWeekStart; setPendingWeekStart(null); save({ workweekStartDay: v }); }}
                  className="h-9 px-3 rounded-lg bg-warning/20 border border-warning/30 font-semibold cursor-pointer"
                >
                  Change workweek
                </button>
                <button
                  type="button"
                  onClick={() => setPendingWeekStart(null)}
                  className="h-9 px-3 rounded-lg bg-fill-strong border border-line-stronger text-fg-secondary font-semibold cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Punch rounding */}
        <div className="pt-4 border-t border-line/60">
          <label htmlFor="punch-rounding" className="text-sm font-semibold text-fg-body block mb-1.5">Punch rounding</label>
          <select
            id="punch-rounding"
            value={rules.roundingMinutes}
            onChange={(e) => save({ roundingMinutes: Number(e.target.value) as RoundingMinutes })}
            className={selectClass}
          >
            {ROUNDING_OPTIONS.map((m) => (
              <option key={m} value={m}>{ROUNDING_LABELS[m]}{m === DEFAULT_PAY_RULES.roundingMinutes ? " (default)" : ""}</option>
            ))}
          </select>
          <div className="text-xs text-fg-subtle mt-1.5">
            Rounds clock-ins and clock-outs the same way, for pay only; the real punch times are kept and the time card shows both.
            Rounding must be neutral over time and never favor the employer. Paying exact time is the safest choice.
          </div>
        </div>

        {problem && <div role="alert" className="text-xs text-danger-fg">{problem}</div>}
      </div>
    </section>
  );
}
