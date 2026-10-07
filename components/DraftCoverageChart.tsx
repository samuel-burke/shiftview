"use client";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  ComposedChart,
  Area,
  Line,
  LineChart,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Schedule, StoreHours, fmtMinutes } from "../data/types";
import { dayOfWeek, headcountAt, scheduledHoursForDate } from "../lib/draft-metrics";
import { CoverageBlock, SLOT_MINUTES, curveHours, targetAt } from "../lib/coverage";
import { formatDateKey } from "../lib/dates";
import { useTheme } from "./ThemeProvider";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Props = {
  drafts: Schedule[];
  dates: string[]; // 7 YYYY-MM-DD dates
  storeHours: Record<number, StoreHours>;
  curves: Record<string, CoverageBlock[]>; // date -> target coverage curve
  // The Week page's selected day: the By Hour view shows it. The page's day
  // picker is the only one; onPickDay takes the user there.
  selectedDate: string;
  onPickDay?: () => void;
  // Store timezone — makes scheduled hours real elapsed time across DST.
  timezone?: string;
};

function LegendChip({ color, label, dashed = false }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded-full border border-slate-700/40">
      <span
        className="inline-block w-2.5 h-0.5 rounded-full"
        style={dashed ? { backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 3px, transparent 3px 5px)` } : { background: color }}
      />
      {label}
    </span>
  );
}

export default function DraftCoverageChart({ drafts, dates, storeHours, curves, selectedDate, onPickDay, timezone }: Props) {
  const { mode } = useTheme();
  const isLight = mode === "light" ||
    (mode === "system" && typeof window !== "undefined" && !window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [view, setView] = useState<"day" | "hour">("day");

  const tooltipStyle = {
    background: isLight ? "#ffffff" : "#0f172a",
    border: isLight ? "1px solid #e2e8f0" : "1px solid #334155",
    borderRadius: 8,
    fontSize: 12,
    color: isLight ? "#0f172a" : "#f1f5f9",
  };

  const byDayData = useMemo(
    () => dates.map((date) => ({
      label: DAY_LABELS[dayOfWeek(date)],
      recommended: Math.round(curveHours(curves[date] ?? []) * 10) / 10,
      scheduled: Math.round(scheduledHoursForDate(drafts, date, timezone) * 10) / 10,
    })),
    [dates, drafts, curves, timezone]
  );

  const hourDate = dates.includes(selectedDate) ? selectedDate : dates[0];
  const hourCurve = curves[hourDate] ?? [];
  const hourDayHours = storeHours[dayOfWeek(hourDate)];

  // X-range covers the store's open hours and the curve span, whichever is wider.
  const hourRange = useMemo(() => {
    const starts = [...hourCurve.map((b) => b.startMinutes)];
    const ends = [...hourCurve.map((b) => b.endMinutes)];
    if (hourDayHours && hourDayHours.close > hourDayHours.open) {
      starts.push(hourDayHours.open);
      ends.push(hourDayHours.close);
    }
    if (starts.length === 0) return null;
    return { start: Math.min(...starts), end: Math.max(...ends) };
  }, [hourCurve, hourDayHours]);

  const byHourData = useMemo(() => {
    if (!hourRange) return [];
    const pts: { label: string; scheduled: number; target: number }[] = [];
    for (let m = hourRange.start; m <= hourRange.end; m += SLOT_MINUTES) {
      const sample = Math.min(m, hourRange.end - 1);
      pts.push({
        label: fmtMinutes(m),
        scheduled: headcountAt(drafts, hourDate, sample),
        target: targetAt(hourCurve, sample),
      });
    }
    return pts;
  }, [drafts, hourDate, hourCurve, hourRange]);

  const hourTicks = useMemo(() => {
    if (!hourRange) return [];
    const result: string[] = [];
    for (let m = hourRange.start; m <= hourRange.end; m += 240) result.push(fmtMinutes(m));
    return result;
  }, [hourRange]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="bg-card rounded-2xl pt-4 px-[10px] pb-[10px] mb-4"
      style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}
    >
      <div className="flex items-center justify-between mb-2 pl-1.5 pr-1 gap-2 flex-wrap">
        <p className="text-[11px] font-bold tracking-[0.1em] text-slate-400 uppercase">
          Coverage: Recommended vs Scheduled
        </p>
        <div className="flex rounded-lg bg-slate-800/60 border border-slate-700/40 p-0.5" role="tablist" aria-label="Coverage view">
          {(["day", "hour"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`min-h-8 px-3 text-[11px] font-semibold rounded-md cursor-pointer transition-colors border-none ${
                view === v ? "bg-indigo-600/40 text-indigo-200" : "bg-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              {v === "day" ? "By Day" : "By Hour"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3 pl-1.5">
        <LegendChip color="#818cf8" label="Recommended" dashed />
        <LegendChip color="#3b82f6" label="Scheduled" />
        {view === "hour" && (
          // The day comes from the Week page's day picker.
          <span className="ml-auto flex items-center gap-1 pr-1">
            <span data-testid="coverage-chart-day" className="text-xs font-semibold text-slate-200 whitespace-nowrap">
              {formatDateKey(hourDate, { weekday: "short", month: "short", day: "numeric" })}
            </span>
            {onPickDay && (
              <button
                onClick={onPickDay}
                className="min-h-8 px-2 text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer"
              >
                Change day
              </button>
            )}
          </span>
        )}
      </div>

      {/* Height from CSS (no layout jump): 2.6:1 with the width, 170px (phone size) to 280px. */}
      <div className="w-full min-w-0 aspect-[2.6/1] min-h-[170px] max-h-[280px]">
      <ResponsiveContainer width="100%" height="100%" style={{ overflow: "visible" }}>
        {view === "day" ? (
          <LineChart data={byDayData} margin={{ top: 12, right: 8, left: -28, bottom: 0 }}>
            <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v, name) => [`${v} hrs`, name === "recommended" ? "Recommended" : "Scheduled"]}
            />
            <Line type="monotone" dataKey="recommended" stroke="#818cf8" strokeWidth={2} strokeDasharray="5 4" dot={false} />
            <Line type="monotone" dataKey="scheduled" stroke="#3b82f6" strokeWidth={2.5} dot={{ r: 2.5, fill: "#3b82f6", strokeWidth: 0 }} />
          </LineChart>
        ) : (
          <ComposedChart data={byHourData} margin={{ top: 12, right: 8, left: -28, bottom: 0 }}>
            <defs>
              <linearGradient id="draftCovGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} ticks={hourTicks} />
            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v, name) => (name === "target" ? [`${v} target`, "Recommended"] : [`${v} scheduled`, "Scheduled"])}
            />
            <Area type="stepAfter" dataKey="scheduled" stroke="#3b82f6" strokeWidth={2.5} fill="url(#draftCovGrad)" dot={false} />
            <Line type="stepAfter" dataKey="target" stroke="#818cf8" strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={false} />
          </ComposedChart>
        )}
      </ResponsiveContainer>
      </div>
    </motion.div>
  );
}
