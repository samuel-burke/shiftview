"use client";
import { useMemo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Schedule } from "../data/types";
import { dayOfWeek, scheduledHoursForDate } from "../lib/draft-metrics";
import { CoverageBlock, curveHours } from "../lib/coverage";
import { useTheme } from "./ThemeProvider";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Props = {
  drafts: Schedule[];
  dates: string[]; // 7 YYYY-MM-DD dates
  curves: Record<string, CoverageBlock[]>; // date -> target coverage curve
  isManager: boolean;
  // Store timezone — makes scheduled hours real elapsed time across DST.
  timezone?: string;
};

/**
 * Daily budget vs scheduled hours. The budget is derived from the day's
 * target coverage curve (area under the curve, in staff-hours).
 */
export default function DraftBudgetChart({ drafts, dates, curves, isManager, timezone }: Props) {
  const { mode } = useTheme();
  const isLight = mode === "light" ||
    (mode === "system" && typeof window !== "undefined" && !window.matchMedia("(prefers-color-scheme: dark)").matches);

  const data = useMemo(
    () => dates.map((date) => {
      const scheduled = Math.round(scheduledHoursForDate(drafts, date, timezone) * 10) / 10;
      const budget = Math.round(curveHours(curves[date] ?? []) * 10) / 10;
      return { label: DAY_LABELS[dayOfWeek(date)], date, budget, scheduled, variance: Math.round((scheduled - budget) * 10) / 10 };
    }),
    [dates, drafts, curves, timezone]
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.05, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="bg-card rounded-2xl pt-4 px-[10px] pb-[10px] mb-4"
      style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}
    >
      <div className="flex items-center justify-between mb-3 pl-1.5 pr-1">
        <p className="text-[11px] font-bold tracking-[0.1em] text-slate-400 uppercase">
          Daily Budget vs Scheduled Hours
        </p>
        {isManager && (
          <Link
            href="/coverage"
            className="flex items-center min-h-8 -my-1.5 text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            Edit Coverage →
          </Link>
        )}
      </div>

      <div className="flex items-center gap-2 mb-3 pl-1.5">
        <span className="flex items-center gap-1.5 text-[11px] text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded-full border border-slate-700/40">
          <span className="inline-block w-2 h-2 rounded-[3px] bg-slate-500" />
          Budget
        </span>
        <span className="flex items-center gap-1.5 text-[11px] text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded-full border border-slate-700/40">
          <span className="inline-block w-2 h-2 rounded-[3px] bg-blue-500" />
          Scheduled
        </span>
      </div>

      {/* Height from CSS (no layout jump): 2.6:1 with the width, 170px (phone size) to 280px. */}
      <div className="w-full min-w-0 aspect-[2.6/1] min-h-[170px] max-h-[280px]">
      <ResponsiveContainer width="100%" height="100%" style={{ overflow: "visible" }}>
        <BarChart data={data} margin={{ top: 12, right: 8, left: -28, bottom: 0 }} barGap={2}>
          <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: isLight ? "rgba(148,163,184,0.12)" : "rgba(148,163,184,0.08)" }}
            contentStyle={{
              background: isLight ? "#ffffff" : "#0f172a",
              border: isLight ? "1px solid #e2e8f0" : "1px solid #334155",
              borderRadius: 8,
              fontSize: 12,
              color: isLight ? "#0f172a" : "#f1f5f9",
            }}
            formatter={(v, name) => [`${v} hrs`, name === "budget" ? "Budget" : "Scheduled"]}
          />
          <Bar dataKey="budget" fill="#64748b" radius={[4, 4, 0, 0]} maxBarSize={18} />
          <Bar dataKey="scheduled" fill="#3b82f6" radius={[4, 4, 0, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
      </div>

      {/* Per-day variance strip */}
      <div className="grid grid-cols-7 gap-1 px-1.5 mt-1" aria-label="Daily variance (scheduled minus budget)">
        {data.map((d) => (
          <div
            key={d.date}
            className={`text-center text-[11px] font-bold tabular-nums ${
              d.variance > 0 ? "text-red-400" : d.variance < 0 ? "text-amber-400" : "text-green-500"
            }`}
          >
            {d.variance > 0 ? `+${d.variance}` : d.variance}
          </div>
        ))}
      </div>
    </motion.div>
  );
}
