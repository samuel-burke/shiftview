"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { motion } from "framer-motion";
import { fmtMinutes, type Schedule, type StoreHours } from "@/data/types";
import { dayOfWeek, scheduledHoursForDate } from "@/lib/draft-metrics";
import { coverageScoreFromCurves, curveHours, findUnderstaffedFromCurves, type CoverageBlock } from "@/lib/coverage";
import type { SchedulingRules } from "@/lib/scheduling-rules";
import type { PlannerEmployee } from "../AutoScheduleSheet";
import WeekCoverageHeatmap from "../WeekCoverageHeatmap";
import DraftHoursPanel from "../DraftHoursPanel";
import { SkeletonBudgetChart } from "../Skeleton";

// The Week page's coverage tools, for whichever week the mode shows: the live
// shifts in Live, the week after publishing in Draft. They take any shifts.

// recharts is heavy; code-split the chart out of the route's initial bundle.
// Its placeholder is the chart's own box, so the heatmap and hours under it
// stay put when the chunk lands (with a short day list, they're on screen).
const DraftCoverageChart = dynamic(() => import("../DraftCoverageChart"), { ssr: false, loading: () => <SkeletonBudgetChart /> });

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const round1 = (n: number) => Math.round(n * 10) / 10;

function StatCard({
  index,
  value,
  suffix,
  label,
  color,
  loading,
}: {
  index: number;
  value: string;
  suffix?: string;
  label: string;
  color: string;
  loading: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.25, delay: index * 0.05, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="relative bg-card rounded-xl px-2 py-3 text-center overflow-hidden"
      style={{ border: `1px solid ${color}33` }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: `radial-gradient(ellipse at 50% 0%, ${color}09 0%, transparent 70%)` }}
      />
      {loading ? (
        // The value's own box: a 22px line (text-[22px] leading-none).
        <div className="flex justify-center">
          <div className="skeleton h-[22px] w-10 rounded-[6px]" />
        </div>
      ) : (
        // A fixed 22px line: the smaller "hrs" on the baseline would otherwise
        // make it a pixel taller than the skeleton above.
        <div className="relative h-[22px] flex items-baseline justify-center gap-0.5">
          <span className="text-[22px] font-extrabold leading-none tabular-nums" style={{ color }}>{value}</span>
          {suffix && <span className="text-[11px] font-bold" style={{ color }}>{suffix}</span>}
        </div>
      )}
      <div className="text-[11px] text-slate-400 mt-1 font-medium relative">{label}</div>
    </motion.div>
  );
}

/** Variance color: over budget red, under amber, on budget green. */
export function varianceColor(variance: number): string {
  return variance > 0 ? "#f87171" : variance < 0 ? "#fbbf24" : "#22c55e";
}

/** The week at a glance: budget, scheduled hours, variance and coverage score. */
export function WeekStats({
  shifts,
  dates,
  curves,
  timezone,
  loading,
}: {
  shifts: Schedule[];
  dates: string[];
  curves: Record<string, CoverageBlock[]>;
  timezone?: string;
  loading: boolean;
}) {
  const budget = dates.reduce((sum, d) => sum + curveHours(curves[d] ?? []), 0);
  const scheduled = dates.reduce((sum, d) => sum + scheduledHoursForDate(shifts, d, timezone), 0);
  const variance = round1(scheduled - budget);
  const score = useMemo(() => coverageScoreFromCurves(shifts, dates, curves), [shifts, dates, curves]);

  return (
    <div className="grid grid-cols-4 gap-2" data-testid="week-stats">
      <StatCard index={0} value={String(Math.round(budget))} suffix="hrs" label="Weekly Budget" color="#818cf8" loading={loading} />
      <StatCard index={1} value={String(round1(scheduled))} suffix="hrs" label="Scheduled" color="#3b82f6" loading={loading} />
      <StatCard index={2} value={variance > 0 ? `+${variance}` : String(variance)} suffix="hrs" label="Variance" color={varianceColor(variance)} loading={loading} />
      <StatCard index={3} value={score === null ? "—" : String(score)} suffix={score === null ? undefined : "%"} label="Coverage Score" color="#22c55e" loading={loading} />
    </div>
  );
}

type Props = {
  shifts: Schedule[];
  dates: string[];
  curves: Record<string, CoverageBlock[]>;
  storeHours: Record<number, StoreHours>;
  employees: PlannerEmployee[];
  rules: SchedulingRules;
  timezone?: string;
  loading: boolean;
  /** The page's selected day: the hourly chart shows it, the heatmap highlights it. */
  selectedDate: string;
  onSelectDate: (date: string) => void;
  /** Takes the user to the page's day picker. */
  onPickDay: () => void;
};

/** Budget vs scheduled, understaffed alerts, the hour-by-hour heatmap and each person's hours. */
export default function WeekInsights({
  shifts,
  dates,
  curves,
  storeHours,
  employees,
  rules,
  timezone,
  loading,
  selectedDate,
  onSelectDate,
  onPickDay,
}: Props) {
  const [alertsExpanded, setAlertsExpanded] = useState(false);
  const alerts = useMemo(
    () =>
      findUnderstaffedFromCurves(shifts, dates, curves).map((a) => ({
        key: `${a.date}-${a.startMinutes}`,
        text: `${DAY_LABELS[dayOfWeek(a.date)]} ${fmtMinutes(a.startMinutes)}–${fmtMinutes(a.endMinutes)}: Understaffed by ${a.shortfall}`,
      })),
    [shifts, dates, curves]
  );

  return (
    // Tablets and up: the chart and everyone's hours side by side, then the
    // alerts and the heatmap across the width. Phones: one column, hours last.
    <section aria-label="Coverage" className="tablet:grid tablet:grid-cols-2 tablet:gap-x-4 tablet:items-start">
      <div className="min-w-0 tablet:row-start-1 tablet:col-start-1">
        <DraftCoverageChart
          drafts={shifts}
          dates={dates}
          storeHours={storeHours}
          curves={curves}
          selectedDate={selectedDate}
          onPickDay={onPickDay}
          timezone={timezone}
          isManager
        />
      </div>

      {!loading && alerts.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 tablet:col-span-2"
          data-testid="understaffed-alerts"
        >
          {(alertsExpanded ? alerts : alerts.slice(0, 1)).map((a) => (
            <div key={a.key} className="flex items-center gap-2 text-xs text-amber-400 py-0.5">
              <span aria-hidden="true">⚠</span> {a.text}
            </div>
          ))}
          {alerts.length > 1 && (
            <button
              type="button"
              onClick={() => setAlertsExpanded((v) => !v)}
              className="min-h-8 -mb-1.5 text-[11px] font-semibold text-amber-300/80 hover:text-amber-200 bg-transparent border-none cursor-pointer p-0"
            >
              {alertsExpanded ? "Show less" : `${alerts.length - 1} more alert${alerts.length - 1 === 1 ? "" : "s"} →`}
            </button>
          )}
        </motion.div>
      )}

      {!loading && (
        <>
          <div className="min-w-0 tablet:col-span-2">
            <WeekCoverageHeatmap
              shifts={shifts}
              dates={dates}
              curves={curves}
              selectedDate={selectedDate}
              onSelectDate={onSelectDate}
            />
          </div>
          <div className="min-w-0 tablet:row-start-1 tablet:col-start-2">
            <DraftHoursPanel employees={employees} drafts={shifts} dates={dates} rules={rules} timezone={timezone} />
          </div>
        </>
      )}
    </section>
  );
}
