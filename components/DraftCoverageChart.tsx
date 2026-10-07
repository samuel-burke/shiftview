"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Area, Bar, BarChart, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Schedule, StoreHours, fmtMinutes } from "../data/types";
import { dayOfWeek, headcountAt, scheduledHoursForDate } from "../lib/draft-metrics";
import { CoverageBlock, SLOT_MINUTES, curveHours, targetAt } from "../lib/coverage";
import { formatDateKey } from "../lib/dates";
import { useTheme } from "./ThemeProvider";

// Budget vs scheduled, in one chart with two views.
// By Day: each day's scheduled hours (columns) against its budget, the hours
// under the day's coverage target (a marker line), with the difference under
// each day. By Hour: the selected day's headcount against the people needed.
// Scheduled is the accent hue; the budget is neutral ink, which stays distinct
// from the blue for colorblind readers (indigo didn't: ΔE 4.5 under protanopia).

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SCHEDULED = "#3b82f6";
const round1 = (n: number) => Math.round(n * 10) / 10;

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
  /** Shows the link to edit the coverage targets the budget comes from. */
  isManager?: boolean;
};

type DayRow = { date: string; label: string; budget: number; scheduled: number; variance: number };

const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`);

function varianceWords(v: number): string {
  if (v === 0) return "On budget";
  return `${Math.abs(v)} hrs ${v > 0 ? "over" : "under"} budget`;
}

function theme(isLight: boolean) {
  return {
    ink: isLight ? "#475569" : "#cbd5e1", // the budget (slate-600 / slate-300)
    surface: isLight ? "#ffffff" : "#111827", // the card, for the marker's ring
    axis: isLight ? "#64748b" : "#94a3b8",
    // Over budget, under, on budget: the app's variance colors, per theme.
    over: isLight ? "#dc2626" : "#f87171",
    under: isLight ? "#b45309" : "#fbbf24",
    met: isLight ? "#15803d" : "#22c55e",
  };
}

function LegendKey({ kind, color, label }: { kind: "column" | "line" | "dashed" | "marker"; color: string; label: string }) {
  const key =
    kind === "column" ? (
      <span className="inline-block w-2 h-2.5 rounded-t-[2px]" style={{ background: color }} />
    ) : (
      <span
        className={`inline-block w-3 rounded-full ${kind === "marker" ? "h-[3px]" : "h-0.5"}`}
        style={
          kind === "dashed"
            ? { backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 3px, transparent 3px 5px)` }
            : { background: color }
        }
      />
    );
  return (
    <span className="flex items-center gap-1.5 text-[11px] text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded-full border border-slate-700/40">
      {key}
      {label}
    </span>
  );
}

export default function DraftCoverageChart({ drafts, dates, storeHours, curves, selectedDate, onPickDay, timezone, isManager = false }: Props) {
  const { mode } = useTheme();
  const isLight = mode === "light" ||
    (mode === "system" && typeof window !== "undefined" && !window.matchMedia("(prefers-color-scheme: dark)").matches);
  const colors = theme(isLight);
  const [view, setView] = useState<"day" | "hour">("day");

  const tooltipStyle = {
    background: isLight ? "#ffffff" : "#0f172a",
    border: isLight ? "1px solid #e2e8f0" : "1px solid #334155",
    borderRadius: 8,
    fontSize: 12,
    color: isLight ? "#0f172a" : "#f1f5f9",
  };
  const varianceColor = (v: number) => (v > 0 ? colors.over : v < 0 ? colors.under : colors.met);

  const byDay = useMemo(
    (): DayRow[] =>
      dates.map((date) => {
        const budget = round1(curveHours(curves[date] ?? []));
        const scheduled = round1(scheduledHoursForDate(drafts, date, timezone));
        return { date, label: DAY_LABELS[dayOfWeek(date)], budget, scheduled, variance: round1(scheduled - budget) };
      }),
    [dates, drafts, curves, timezone]
  );

  const hourDate = dates.includes(selectedDate) ? selectedDate : dates[0];
  const hourCurve = useMemo(() => curves[hourDate] ?? [], [curves, hourDate]);
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
      data-testid="budget-chart"
    >
      <div className="flex items-center justify-between mb-2 pl-1.5 pr-1 gap-2 flex-wrap">
        <h2 className="text-[11px] font-bold tracking-[0.1em] text-slate-400 uppercase">Budget vs Scheduled</h2>
        <div className="flex rounded-lg bg-slate-800/60 border border-slate-700/40 p-0.5" role="tablist" aria-label="Budget view">
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
        {view === "day" ? (
          <>
            <LegendKey kind="column" color={SCHEDULED} label="Scheduled hrs" />
            <LegendKey kind="marker" color={colors.ink} label="Budget hrs" />
          </>
        ) : (
          <>
            <LegendKey kind="line" color={SCHEDULED} label="Scheduled" />
            <LegendKey kind="dashed" color={colors.ink} label="Needed" />
            {/* The day comes from the Week page's day picker. */}
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
          </>
        )}
      </div>

      {/* Height from CSS (no layout jump): 2.6:1 with the width, 190px (phone size) to 300px. */}
      <div className="w-full min-w-0 aspect-[2.6/1] min-h-[190px] max-h-[300px]">
        <ResponsiveContainer width="100%" height="100%" style={{ overflow: "visible" }}>
          {view === "day" ? (
            // A BarChart (not Composed) so hovering highlights the day's band.
            <BarChart data={byDay} margin={{ top: 12, right: 8, left: -28, bottom: 0 }}>
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                height={40}
                interval={0}
                // The day, and under it how far its scheduled hours are from the budget.
                tick={({ x, y, index }: { x?: number | string; y?: number | string; index?: number }) => {
                  const row = index === undefined ? undefined : byDay[index];
                  if (!row) return <g />;
                  return (
                    <g transform={`translate(${x},${y})`}>
                      <text dy={10} textAnchor="middle" fill={colors.axis} fontSize={11}>{row.label}</text>
                      <text dy={27} textAnchor="middle" fill={varianceColor(row.variance)} fontSize={11} fontWeight={700}>
                        {signed(row.variance)}
                      </text>
                    </g>
                  );
                }}
              />
              <YAxis tick={{ fill: colors.axis, fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: isLight ? "rgba(148,163,184,0.12)" : "rgba(148,163,184,0.08)" }}
                content={({ active, payload }) => {
                  const row = active ? (payload?.[0]?.payload as DayRow | undefined) : undefined;
                  if (!row) return null;
                  return (
                    <div style={{ ...tooltipStyle, padding: "8px 10px" }}>
                      <div className="font-semibold mb-1">{formatDateKey(row.date, { weekday: "short", month: "short", day: "numeric" })}</div>
                      <div className="flex items-center gap-1.5">
                        <span className="inline-block w-2 h-2.5 rounded-t-[2px]" style={{ background: SCHEDULED }} />
                        Scheduled {row.scheduled} hrs
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="inline-block w-2 h-[3px] rounded-full" style={{ background: colors.ink }} />
                        Budget {row.budget} hrs
                      </div>
                      <div className="mt-1 font-semibold" style={{ color: varianceColor(row.variance) }}>{varianceWords(row.variance)}</div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="scheduled" fill={SCHEDULED} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
              {/* The budget: a marker across each day's column, ringed in the card's color
                  so it stays readable where it crosses the column. */}
              <Line
                dataKey="budget"
                stroke="none"
                isAnimationActive={false}
                activeDot={false}
                dot={({ cx, cy, index }: { cx?: number; cy?: number; index?: number }) =>
                  cx == null || cy == null ? (
                    <g key={index} />
                  ) : (
                    <g key={index}>
                      <line x1={cx - 16} x2={cx + 16} y1={cy} y2={cy} stroke={colors.surface} strokeWidth={7} strokeLinecap="round" />
                      <line x1={cx - 15} x2={cx + 15} y1={cy} y2={cy} stroke={colors.ink} strokeWidth={3} strokeLinecap="round" />
                    </g>
                  )
                }
              />
            </BarChart>
          ) : (
            <ComposedChart data={byHourData} margin={{ top: 12, right: 8, left: -28, bottom: 0 }}>
              <defs>
                <linearGradient id="draftCovGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={SCHEDULED} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={SCHEDULED} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" tick={{ fill: colors.axis, fontSize: 11 }} tickLine={false} axisLine={false} ticks={hourTicks} />
              <YAxis tick={{ fill: colors.axis, fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(v, name) => (name === "target" ? [`${v} needed`, "Needed"] : [`${v} scheduled`, "Scheduled"])}
              />
              <Area type="stepAfter" dataKey="scheduled" stroke={SCHEDULED} strokeWidth={2} fill="url(#draftCovGrad)" dot={false} />
              <Line type="stepAfter" dataKey="target" stroke={colors.ink} strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={false} />
            </ComposedChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* The same numbers as a table, for screen readers. The wrapper hides it:
          a table ignores the 1px width and would widen the page. */}
      {view === "day" && (
        <div className="sr-only">
        <table>
          <caption>Scheduled hours against the budget, by day</caption>
          <thead>
            <tr><th scope="col">Day</th><th scope="col">Scheduled</th><th scope="col">Budget</th><th scope="col">Difference</th></tr>
          </thead>
          <tbody>
            {byDay.map((d) => (
              <tr key={d.date}>
                <th scope="row">{formatDateKey(d.date, { weekday: "long", month: "long", day: "numeric" })}</th>
                <td>{d.scheduled} hrs</td>
                <td>{d.budget} hrs</td>
                <td>{varianceWords(d.variance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {isManager && (
        <div className="flex justify-end pr-1 mt-1">
          <Link
            href="/coverage"
            className="flex items-center min-h-8 text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            Edit coverage targets →
          </Link>
        </div>
      )}
    </motion.div>
  );
}
