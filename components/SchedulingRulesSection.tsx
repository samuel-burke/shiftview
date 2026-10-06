"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_WEEKLY_HOURS, type SchedulingRules } from "@/lib/scheduling-rules";
import SegmentedControl from "./SegmentedControl";
import SaveStatusText, { type SaveStatus } from "./SaveStatusText";

// Settings → Workplace → Scheduling Rules: the org-wide rules the Planner's
// Auto-schedule works within (lib/scheduling-rules.ts). Each change saves
// immediately, like the other workplace settings.

function fmtHours(minutes: number): string {
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`;
}

// Shift lengths in half-hour steps, 1–16 h.
const SHIFT_LENGTHS = Array.from({ length: 31 }, (_, i) => 60 + i * 30);
// Rest between shifts in whole hours, 0–16 h.
const REST_OPTIONS = Array.from({ length: 17 }, (_, i) => i * 60);
const DAY_COUNTS = [1, 2, 3, 4, 5, 6, 7];

const selectClass =
  "bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 tabular-nums focus:outline-none focus:border-indigo-500/70 cursor-pointer";
const hoursInputClass =
  "w-16 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 text-right tabular-nums focus:outline-none focus:border-indigo-500/70";

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 tablet:flex-row tablet:items-center tablet:justify-between tablet:gap-4">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-200">{title}</div>
        {desc && <div className="text-xs text-slate-500 mt-0.5">{desc}</div>}
      </div>
      <div className="shrink-0 tablet:min-w-[220px] tablet:max-w-[260px] flex items-center gap-2 tablet:justify-end">{children}</div>
    </div>
  );
}

// A weekly-hours input that commits on blur. Whole or half hours only.
function HoursField({
  value,
  ariaLabel,
  onCommit,
}: {
  value: number;
  ariaLabel: string;
  onCommit: (hours: number) => void;
}) {
  const [text, setText] = useState(String(value));
  // Follow a value saved (or reverted) elsewhere.
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(String(value));
  }
  return (
    <input
      type="number"
      inputMode="decimal"
      min={0}
      max={MAX_WEEKLY_HOURS}
      step={0.5}
      aria-label={ariaLabel}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const n = Math.round(Number(text) * 2) / 2;
        if (text.trim() === "" || !Number.isFinite(n)) { setText(String(value)); return; }
        const clamped = Math.min(MAX_WEEKLY_HOURS, Math.max(0, n));
        setText(String(clamped));
        if (clamped !== value) onCommit(clamped);
      }}
      className={hoursInputClass}
    />
  );
}

export default function SchedulingRulesSection({
  rules,
  onSaved,
}: {
  rules: SchedulingRules;
  onSaved: (rules: SchedulingRules) => void;
}) {
  const [draft, setDraft] = useState(rules);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow rules loaded after mount.
  const [shownRules, setShownRules] = useState(rules);
  if (rules !== shownRules) {
    setShownRules(rules);
    setDraft(rules);
  }
  useEffect(() => () => { if (statusTimer.current) clearTimeout(statusTimer.current); }, []);

  function flash(next: SaveStatus, ms: number) {
    setStatus(next);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus("idle"), ms);
  }

  async function save(patch: Partial<SchedulingRules>) {
    const next = { ...draft, ...patch };
    if (next.fullTimeMinHours > next.fullTimeMaxHours || next.partTimeMinHours > next.partTimeMaxHours) {
      setProblem("The minimum hours can't be more than the maximum.");
      return;
    }
    setProblem(null);
    const prev = draft;
    setDraft(next);
    setStatus("saving");
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schedulingRules: patch }),
    }).catch(() => null);
    if (res?.ok) {
      onSaved(next);
      flash("saved", 2000);
    } else {
      setDraft(prev);
      flash("error", 4000);
    }
  }

  return (
    <section data-testid="scheduling-rules-section">
      <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
        Scheduling Rules
      </div>
      <div className="bg-card rounded-2xl border border-slate-800/60 px-4 py-4">
        <div className="text-xs text-slate-500 pb-4 mb-0 border-b border-slate-800/60">
          Auto-schedule in the Planner always follows these. Employees&apos; availability and approved time off come first.
        </div>
        <div className="flex flex-col divide-y divide-slate-800/60 pt-4">
          <Row title="Shift Length" desc="Generated shifts fall in this range">
            <select
              aria-label="Shortest shift"
              value={draft.minShiftMinutes}
              onChange={(e) => save({ minShiftMinutes: Number(e.target.value) })}
              className={selectClass}
            >
              {SHIFT_LENGTHS.filter((m) => m <= draft.maxShiftMinutes).map((m) => (
                <option key={m} value={m}>{fmtHours(m)}</option>
              ))}
            </select>
            <span className="text-xs text-slate-500">to</span>
            <select
              aria-label="Longest shift"
              value={draft.maxShiftMinutes}
              onChange={(e) => save({ maxShiftMinutes: Number(e.target.value) })}
              className={selectClass}
            >
              {SHIFT_LENGTHS.filter((m) => m >= draft.minShiftMinutes).map((m) => (
                <option key={m} value={m}>{fmtHours(m)}</option>
              ))}
            </select>
          </Row>

          <Row title="Start Times" desc="Shifts start on the quarter hour, half hour or hour">
            <div className="w-full">
              <SegmentedControl
                ariaLabel="Shift start times"
                value={draft.startGranularityMinutes}
                onChange={(v) => save({ startGranularityMinutes: v })}
                options={[
                  { value: 15, label: ":15" },
                  { value: 30, label: ":30" },
                  { value: 60, label: "Hour" },
                ]}
              />
            </div>
          </Row>

          <Row title="Rest Between Shifts" desc="No closing shift followed by an early open">
            <select
              aria-label="Minimum rest between shifts"
              value={draft.minRestMinutes}
              onChange={(e) => save({ minRestMinutes: Number(e.target.value) })}
              className={selectClass}
            >
              {REST_OPTIONS.map((m) => (
                <option key={m} value={m}>{m === 0 ? "No minimum" : fmtHours(m)}</option>
              ))}
            </select>
          </Row>

          <Row title="Days in a Row" desc="Most consecutive days anyone works">
            <select
              aria-label="Most consecutive working days"
              value={draft.maxConsecutiveDays}
              onChange={(e) => save({ maxConsecutiveDays: Number(e.target.value) })}
              className={selectClass}
            >
              {DAY_COUNTS.map((d) => (
                <option key={d} value={d}>{d} day{d === 1 ? "" : "s"}</option>
              ))}
            </select>
          </Row>

          <Row title="Overtime" desc="Hours past 40 a week, paid at 1.5×">
            <div className="w-full">
              <SegmentedControl
                ariaLabel="Overtime"
                value={draft.overtimePolicy}
                onChange={(v) => save({ overtimePolicy: v })}
                options={[
                  { value: "never", label: "Never" },
                  { value: "when_needed", label: "To fill gaps" },
                ]}
              />
            </div>
          </Row>

          <Row title="Pending Time Off" desc="Requests you haven't approved yet">
            <div className="w-full">
              <SegmentedControl
                ariaLabel="Pending time off"
                value={draft.pendingTimeOff}
                onChange={(v) => save({ pendingTimeOff: v })}
                options={[
                  { value: "avoid", label: "Avoid" },
                  { value: "ignore", label: "Ignore" },
                ]}
              />
            </div>
          </Row>

          {([
            { label: "Full-Time", minKey: "fullTimeMinHours", maxKey: "fullTimeMaxHours", daysKey: "fullTimeMaxDays" },
            { label: "Part-Time", minKey: "partTimeMinHours", maxKey: "partTimeMaxHours", daysKey: "partTimeMaxDays" },
          ] as const).map(({ label, minKey, maxKey, daysKey }) => (
            <Row key={label} title={`${label} Default`} desc="Unless an employee has their own limits">
              <HoursField
                ariaLabel={`${label} minimum weekly hours`}
                value={draft[minKey]}
                onCommit={(h) => save({ [minKey]: h })}
              />
              <span className="text-xs text-slate-500">–</span>
              <HoursField
                ariaLabel={`${label} maximum weekly hours`}
                value={draft[maxKey]}
                onCommit={(h) => save({ [maxKey]: h })}
              />
              <span className="text-xs text-slate-500">h ·</span>
              <select
                aria-label={`${label} most days per week`}
                value={draft[daysKey]}
                onChange={(e) => save({ [daysKey]: Number(e.target.value) })}
                className={selectClass}
              >
                {DAY_COUNTS.map((d) => (
                  <option key={d} value={d}>{d} d</option>
                ))}
              </select>
            </Row>
          ))}
        </div>

        {problem && <div role="alert" className="text-xs text-red-400 mt-3">{problem}</div>}
        <SaveStatusText status={status} testId="scheduling-rules-status" />
      </div>
    </section>
  );
}
