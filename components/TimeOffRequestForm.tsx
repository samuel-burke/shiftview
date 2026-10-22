"use client";

import { useEffect, useState } from "react";
import { addDaysToKey, formatDateKey } from "@/lib/dates";
import { minutesFromTimeInputs } from "@/lib/shift-times";
import { MAX_TIME_OFF_DAYS } from "@/lib/time-off";

// Asks for time off starting on `date`: the whole day (one tap), several days
// (an end date), or part of the day (from–to times).

export type TimeOffRequestBody = { date: string; endDate?: string; startMinutes?: number; endMinutes?: number };

type Mode = "day" | "days" | "part";

export default function TimeOffRequestForm({
  date,
  submitting,
  onSubmit,
}: {
  date: string;
  submitting: boolean;
  onSubmit: (body: TimeOffRequestBody) => void;
}) {
  const [mode, setMode] = useState<Mode>("day");
  const [endDate, setEndDate] = useState(addDaysToKey(date, 1));
  const [from, setFrom] = useState("12:00");
  const [to, setTo] = useState("17:00");
  const [error, setError] = useState<string | null>(null);

  // A new day starts fresh.
  useEffect(() => {
    setMode("day");
    setEndDate(addDaysToKey(date, 1));
    setError(null);
  }, [date]);

  function submit() {
    setError(null);
    if (mode === "days") {
      if (endDate <= date) return setError("Pick an end date after the first day.");
      if (endDate > addDaysToKey(date, MAX_TIME_OFF_DAYS - 1)) return setError(`A request can cover at most ${MAX_TIME_OFF_DAYS} days.`);
      return onSubmit({ date, endDate });
    }
    if (mode === "part") {
      const { startMinutes, endMinutes } = minutesFromTimeInputs(from, to);
      if (endMinutes > 1440 || endMinutes - startMinutes < 15) return setError("The end time must be after the start time, the same day.");
      return onSubmit({ date, startMinutes, endMinutes });
    }
    onSubmit({ date });
  }

  const tabs: { key: Mode; label: string }[] = [
    { key: "day", label: "All day" },
    { key: "days", label: "Several days" },
    { key: "part", label: "Part of day" },
  ];

  return (
    <div className="flex flex-col gap-2" data-testid="time-off-form">
      <div role="radiogroup" aria-label="How much time off" className="grid grid-cols-3 gap-1 rounded-xl bg-fill p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="radio"
            aria-checked={mode === t.key}
            onClick={() => { setMode(t.key); setError(null); }}
            className={`py-2 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
              mode === t.key ? "bg-card text-fg shadow-sm" : "text-fg-muted hover:text-fg-body"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {mode === "days" && (
        <label className="text-xs text-fg-muted flex items-center justify-between gap-3">
          <span>Through</span>
          <input
            type="date"
            aria-label="Last day off"
            value={endDate}
            min={addDaysToKey(date, 1)}
            max={addDaysToKey(date, MAX_TIME_OFF_DAYS - 1)}
            onChange={(e) => { setEndDate(e.target.value); setError(null); }}
            className="bg-card border border-field rounded-lg px-3 py-2 text-fg text-sm"
          />
        </label>
      )}
      {mode === "part" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-fg-muted flex flex-col gap-1">
            From
            <input type="time" aria-label="Off from" value={from} onChange={(e) => { setFrom(e.target.value); setError(null); }}
              className="bg-card border border-field rounded-lg px-3 py-2 text-fg text-sm" />
          </label>
          <label className="text-xs text-fg-muted flex flex-col gap-1">
            To
            <input type="time" aria-label="Off until" value={to} onChange={(e) => { setTo(e.target.value); setError(null); }}
              className="bg-card border border-field rounded-lg px-3 py-2 text-fg text-sm" />
          </label>
        </div>
      )}

      {error && <div role="alert" className="text-xs text-danger-fg">{error}</div>}

      <button
        type="button"
        onClick={submit}
        disabled={submitting}
        aria-busy={submitting}
        className="w-full py-3 rounded-xl bg-gradient-to-r from-brand-from to-brand-to text-on-accent font-bold text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
      >
        {submitting
          ? "Submitting…"
          : mode === "days"
          ? `Request ${formatDateKey(date, { month: "short", day: "numeric" })} – ${formatDateKey(endDate, { month: "short", day: "numeric" })} Off`
          : mode === "part"
          ? "Request Time Off"
          : "Request Day Off"}
      </button>
    </div>
  );
}
