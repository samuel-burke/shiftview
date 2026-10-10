"use client";

import { useEffect, useRef, useState } from "react";
import { SHIFT_COLORS, type ShiftType } from "@/data/types";
import { MAX_WEEKLY_HOURS } from "@/lib/scheduling-rules";
import { PREFERENCE_NOTE_MAX, SHIFT_TYPES, type ShiftPreferences } from "@/lib/preferences";
import SaveStatusText, { type SaveStatus } from "./SaveStatusText";
import FormError from "./FormError";

// What an employee would like to work: shift types, days, weekly hours. The
// Auto-schedule honors these when it can; availability and approved
// time off always come first. Employees edit their own (Settings →
// Preferences); managers can edit anyone's from the Team list (`embedded`).

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const SHIFT_LABELS: Record<ShiftType, string> = { opener: "Opening", mid: "Mid-day", closer: "Closing" };

type Form = {
  preferredShiftTypes: ShiftType[];
  preferredDays: number[];
  avoidDays: number[];
  desiredHours: string; // "" = no preference
  note: string;
};

function toForm(p: ShiftPreferences): Form {
  return {
    preferredShiftTypes: p.preferredShiftTypes,
    preferredDays: p.preferredDays,
    avoidDays: p.avoidDays,
    desiredHours: p.desiredWeeklyHours === null ? "" : String(p.desiredWeeklyHours),
    note: p.note ?? "",
  };
}

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function Chip({
  active,
  tone,
  onClick,
  label,
  ariaLabel,
  dotColor,
}: {
  active: boolean;
  tone: "indigo" | "red";
  onClick: () => void;
  label: string;
  ariaLabel: string;
  dotColor?: string;
}) {
  const activeClass =
    tone === "indigo"
      ? "bg-indigo-500/20 border-indigo-500/40 text-indigo-200"
      : "bg-red-500/15 border-red-500/35 text-red-300";
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={ariaLabel}
      onClick={onClick}
      className={`min-h-[40px] px-3 rounded-xl border text-xs font-semibold cursor-pointer transition-colors flex items-center gap-1.5 ${
        active ? activeClass : "bg-bg border-slate-700 text-slate-400 hover:text-slate-200"
      }`}
    >
      {dotColor && <span aria-hidden="true" className="size-2 rounded-full" style={{ background: dotColor }} />}
      {label}
    </button>
  );
}

export default function ShiftPreferencesSection({
  employeeId,
  firstDayOfWeek,
  embedded = false,
  employeeName,
}: {
  employeeId: number;
  firstDayOfWeek: number;
  embedded?: boolean;
  // Used in labels when a manager edits someone else's preferences.
  employeeName?: string;
}) {
  const [saved, setSaved] = useState<Form | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A different employee starts from a fresh load.
  const [loadedFor, setLoadedFor] = useState(employeeId);
  if (loadedFor !== employeeId) {
    setLoadedFor(employeeId);
    setSaved(null);
    setForm(null);
    setLoadError(false);
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/preferences?employeeId=${employeeId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((p: ShiftPreferences) => {
        if (cancelled) return;
        const f = toForm(p);
        setSaved(f);
        setForm(f);
      })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [employeeId]);

  useEffect(() => () => { if (statusTimer.current) clearTimeout(statusTimer.current); }, []);

  const orderedDays = Array.from({ length: 7 }, (_, i) => (i + firstDayOfWeek) % 7);
  const dirty = form !== null && saved !== null && JSON.stringify(form) !== JSON.stringify(saved);
  const whose = employeeName ? `${employeeName}'s` : "My";

  async function save() {
    if (!form) return;
    const hours = form.desiredHours.trim() === "" ? null : Number(form.desiredHours);
    if (hours !== null && (!Number.isFinite(hours) || hours < 0 || hours > MAX_WEEKLY_HOURS || !Number.isInteger(hours * 2))) {
      setProblem(`Weekly hours must be between 0 and ${MAX_WEEKLY_HOURS}, in whole or half hours.`);
      return;
    }
    setProblem(null);
    setStatus("saving");
    const res = await fetch("/api/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId,
        preferredShiftTypes: form.preferredShiftTypes,
        preferredDays: form.preferredDays,
        avoidDays: form.avoidDays,
        desiredWeeklyHours: hours,
        note: form.note.trim() || null,
      }),
    }).catch(() => null);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    if (res?.ok) {
      const next = toForm((await res.json()) as ShiftPreferences);
      setSaved(next);
      setForm(next);
      setStatus("saved");
      statusTimer.current = setTimeout(() => setStatus("idle"), 2000);
    } else {
      setStatus("error");
      statusTimer.current = setTimeout(() => setStatus("idle"), 4000);
    }
  }

  const body = loadError ? (
    <div className="text-xs text-slate-500">Shift preferences aren&apos;t available right now.</div>
  ) : form === null ? (
    <div role="status" className="text-xs text-slate-500">Loading…</div>
  ) : (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-xs font-semibold text-slate-300 mb-2">Shifts {employeeName ? "they" : "I"} like</div>
        <div className="flex flex-wrap gap-2">
          {SHIFT_TYPES.map((t) => (
            <Chip
              key={t}
              tone="indigo"
              active={form.preferredShiftTypes.includes(t)}
              onClick={() => setForm({ ...form, preferredShiftTypes: toggle(form.preferredShiftTypes, t) })}
              label={SHIFT_LABELS[t]}
              ariaLabel={`Prefer ${SHIFT_LABELS[t].toLowerCase()} shifts`}
              dotColor={SHIFT_COLORS[t]}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-slate-300 mb-2">Days {employeeName ? "they'd" : "I'd"} like to work</div>
        <div className="grid grid-cols-7 gap-1.5">
          {orderedDays.map((d) => (
            <Chip
              key={d}
              tone="indigo"
              active={form.preferredDays.includes(d)}
              onClick={() => setForm({
                ...form,
                preferredDays: toggle(form.preferredDays, d),
                avoidDays: form.avoidDays.filter((x) => x !== d),
              })}
              label={DAY_SHORT[d]}
              ariaLabel={`Prefer ${DAY_FULL[d]}s`}
            />
          ))}
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-slate-300 mb-2">Days {employeeName ? "they'd" : "I'd"} rather not work</div>
        <div className="grid grid-cols-7 gap-1.5">
          {orderedDays.map((d) => (
            <Chip
              key={d}
              tone="red"
              active={form.avoidDays.includes(d)}
              onClick={() => setForm({
                ...form,
                avoidDays: toggle(form.avoidDays, d),
                preferredDays: form.preferredDays.filter((x) => x !== d),
              })}
              label={DAY_SHORT[d]}
              ariaLabel={`Rather not work ${DAY_FULL[d]}s`}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`desired-hours-${employeeId}`} className="text-xs font-semibold text-slate-300">
          Hours {employeeName ? "they'd" : "I'd"} like each week
        </label>
        <div className="flex items-center gap-1.5 shrink-0">
          <input
            id={`desired-hours-${employeeId}`}
            type="number"
            inputMode="decimal"
            min={0}
            max={MAX_WEEKLY_HOURS}
            step={0.5}
            placeholder="Any"
            value={form.desiredHours}
            onChange={(e) => setForm({ ...form, desiredHours: e.target.value })}
            className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 text-right tabular-nums focus:outline-none focus:border-indigo-500/70"
          />
          <span className="text-xs text-slate-500">h</span>
        </div>
      </div>

      <div>
        <label htmlFor={`pref-note-${employeeId}`} className="text-xs font-semibold text-slate-300 mb-2 block">
          {employeeName ? "Note" : "Anything else your manager should know"}
        </label>
        <textarea
          id={`pref-note-${employeeId}`}
          rows={2}
          maxLength={PREFERENCE_NOTE_MAX}
          value={form.note}
          placeholder="e.g. Class until 2 PM on Tuesdays"
          onChange={(e) => setForm({ ...form, note: e.target.value })}
          className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/70 resize-none"
        />
      </div>

      <FormError message={problem} />

      <div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={!dirty || status === "saving"}
            aria-busy={status === "saving"}
            className="text-xs font-semibold px-4 py-2.5 rounded-lg bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Save Preferences
          </button>
        </div>
        <SaveStatusText status={status} testId={`preferences-status-${employeeId}`} />
      </div>
    </div>
  );

  if (embedded) {
    return (
      <div data-testid={`shift-preferences-${employeeId}`} aria-label={`${whose} shift preferences`} role="group">
        {body}
      </div>
    );
  }

  return (
    <section data-testid="shift-preferences-section">
      <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
        Shift Preferences
      </div>
      <div className="bg-card rounded-2xl border border-slate-800/60 px-4 py-4">
        <div className="text-xs text-slate-500 mb-4">
          Your manager&apos;s scheduler uses these when it can. Availability and approved time off always come first.
        </div>
        {body}
      </div>
    </section>
  );
}
