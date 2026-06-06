"use client";
import { useMemo, useRef, useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ReferenceDot,
  ResponsiveContainer,
} from "recharts";
import { Schedule, PunchRecord } from "../data/types";
import { useTheme } from "./ThemeProvider";

type Props = {
  schedules: Schedule[];
  nowMinutes: number;
  isToday: boolean;
  openMinutes: number;
  closeMinutes: number;
  punchRecords?: PunchRecord[];
  timezone?: string;
};

function fmtMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return min === 0
    ? `${h12}:00 ${ampm}`
    : `${h12}:${String(min).padStart(2, "0")} ${ampm}`;
}

function PulsingDot({ cx, cy, color = "#22c55e" }: { cx?: number; cy?: number; color?: string }) {
  if (cx === undefined || cy === undefined) return null;
  return (
    <g aria-hidden="true">
      <circle cx={cx} cy={cy} r={4} fill={color} />
      <circle cx={cx} cy={cy} r={4} fill="none" stroke={color} strokeWidth={2}>
        <animate attributeName="r" values="4;10;4" dur="1.5s" repeatCount="indefinite" />
        <animate attributeName="stroke-opacity" values="0.8;0;0.8" dur="1.5s" repeatCount="indefinite" />
      </circle>
    </g>
  );
}

export default function CoverageTimeline({
  schedules,
  nowMinutes,
  isToday,
  openMinutes,
  closeMinutes,
  punchRecords,
  timezone = "America/New_York",
}: Props) {
  const { mode } = useTheme();
  const isLight = mode === "light" ||
    (mode === "system" && typeof window !== "undefined" && !window.matchMedia("(prefers-color-scheme: dark)").matches);

  const range = closeMinutes - openMinutes;

  const STEP = 15;

  const points = useMemo(() => {
    const pts: { label: string; m: number }[] = [];
    const ms = new Set<number>();
    for (let m = openMinutes; m <= closeMinutes; m += STEP) ms.add(m);
    // Inject the exact current minute so the actual line always ends right at now
    if (isToday && nowMinutes > openMinutes && nowMinutes < closeMinutes) ms.add(nowMinutes);
    for (const m of [...ms].sort((a, b) => a - b)) pts.push({ label: fmtMinutes(m), m });
    return pts;
  }, [openMinutes, closeMinutes, isToday, nowMinutes]);

  const ticks = useMemo(() => {
    const result = [];
    for (let m = openMinutes; m <= closeMinutes; m += 240) {
      result.push(fmtMinutes(m));
    }
    return result;
  }, [openMinutes, closeMinutes]);
  // For each 15-min slot, count employees with status "clocked_in" at that minute.
  // Returns null for future slots so the line terminates at nowMinutes.
  const actualByPoint = useMemo(() => {
    if (!isToday || !punchRecords?.length) return null;

    const withMinutes = punchRecords.map((p) => {
      const d = new Date(p.punchedAt);
      const s = d.toLocaleTimeString("en-US", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const [h, min] = s.split(":").map(Number);
      return { ...p, minuteOfDay: h * 60 + min };
    });

    const byEmployee = new Map<number, typeof withMinutes>();
    for (const p of withMinutes) {
      if (!byEmployee.has(p.employeeId)) byEmployee.set(p.employeeId, []);
      byEmployee.get(p.employeeId)!.push(p);
    }

    return points.map(({ m }) => {
      if (m > nowMinutes) return null;
      let count = 0;
      for (const empPunches of byEmployee.values()) {
        const before = empPunches
          .filter((p) => p.minuteOfDay <= m)
          .sort((a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime());
        if (!before.length) continue;
        const last = before[before.length - 1];
        if (last.punchType === "clock_in" || last.punchType === "break_end") count++;
      }
      return count;
    });
  }, [isToday, punchRecords, points, nowMinutes, timezone]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [showTooltip, setShowTooltip] = useState(true);
  const [chartRect, setChartRect] = useState<{
    left: number;
    width: number;
    top: number;
    height: number;
  } | null>(null);

  const data = useMemo(() => {
    return points.map(({ label, m }, i) => ({
      label,
      staff: schedules.filter(
        (s) => m >= s.startMinutes && m < s.endMinutes,
      ).length,
      actual: actualByPoint ? actualByPoint[i] : undefined,
    }));
  }, [schedules, points, actualByPoint]);

  const nowDataPoint = useMemo(() => {
    if (!isToday) return null;
    const clampedM = Math.min(Math.max(nowMinutes, openMinutes), closeMinutes);
    const label = fmtMinutes(clampedM);
    const staff = schedules.filter(
      (s) => clampedM >= s.startMinutes && clampedM < s.endMinutes,
    ).length;
    const idx = points.findIndex((p) => p.m === clampedM);
    const actual = actualByPoint && idx >= 0 ? actualByPoint[idx] : null;
    return { label, staff, actual };
  }, [isToday, nowMinutes, openMinutes, closeMinutes, schedules, points, actualByPoint]);

  // Measure the actual chart area after mount and on resize
  useEffect(() => {
    function measure() {
      if (!containerRef.current) return;
      const el = containerRef.current;
      // The recharts svg is inside ResponsiveContainer
      const svg = el.querySelector("svg");
      if (!svg) return;
      const svgRect = svg.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      // recharts with margin left=-28, right=8 means:
      // chart plot area starts at ~30px from svg left, ends ~8px from svg right
      const plotLeft = 30;
      const plotRight = 8;
      setChartRect({
        left: svgRect.left - elRect.left + plotLeft,
        width: svgRect.width - plotLeft - plotRight,
        top: svgRect.top - elRect.top,
        height: svgRect.height,
      });
    }
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    // Retry after recharts renders
    const t = setTimeout(measure, 100);
    // Re-measure after orientation change — ResizeObserver fires before the
    // browser finishes laying out the new orientation, so Recharts' SVG still
    // has the old dimensions. A short delay lets everything settle first.
    function onResize() { setTimeout(measure, 150); }
    window.addEventListener("resize", onResize);
    return () => {
      ro.disconnect();
      clearTimeout(t);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  if (range === 0) return null;

  const nowPct = (Math.min(Math.max(nowMinutes, openMinutes), closeMinutes) - openMinutes) / range; // 0–1
  const timeStr = fmtMinutes(nowMinutes);

  // Pixel position of the badge within the container
  const lineLeft = chartRect ? chartRect.left + nowPct * chartRect.width : null;
  const lineTop = chartRect ? chartRect.top + 28 : null; // 28 = margin.top

  return (
    <motion.div
      role="img"
      aria-label={`Coverage timeline from ${fmtMinutes(openMinutes)} to ${fmtMinutes(closeMinutes)}. ${isToday ? `Current time: ${fmtMinutes(nowMinutes)}.` : ""}`}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="bg-card rounded-2xl pt-4 px-[10px] pb-[10px] mb-4"
      style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}
    >
      <div aria-hidden="true" className="flex items-center justify-between mb-3 pl-1.5 pr-1">
        <p className="text-[11px] font-bold tracking-[0.1em] text-slate-400 uppercase">
          Coverage Timeline
        </p>
        <div className="flex items-center gap-2">
          <motion.span
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.15, duration: 0.25 }}
            className="flex items-center gap-1.5 text-[10px] text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded-full border border-slate-700/40"
          >
            <span className="inline-block w-2.5 h-0.5 rounded-full bg-blue-500" />
            Scheduled
          </motion.span>
          {actualByPoint && (
            <motion.span
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.22, duration: 0.25 }}
              className="flex items-center gap-1.5 text-[10px] text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded-full border border-slate-700/40"
            >
              <span className="inline-block w-2.5 h-0.5 rounded-full bg-green-500" />
              Clocked In
            </motion.span>
          )}
        </div>
      </div>

      {/* Wrapper — position relative so overlay can be absolute */}
      <div
        ref={containerRef}
        className="relative"
        onTouchStart={() => setShowTooltip(true)}
        onTouchEnd={() => setShowTooltip(false)}
        onTouchCancel={() => setShowTooltip(false)}
      >
        <ResponsiveContainer
          width="100%"
          height={150}
          style={{ overflow: "visible" }}
        >
          <AreaChart
            data={data}
            margin={{ top: 28, right: 8, left: -28, bottom: 0 }}
          >
            <defs>
              <linearGradient id="covGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.35} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="actualGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22c55e" stopOpacity={0.4} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              tick={{ fill: "#94a3b8", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              ticks={ticks}
            />
            <YAxis
              tick={{ fill: "#94a3b8", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip
              wrapperStyle={showTooltip ? undefined : { display: "none" }}
              contentStyle={{
                background: isLight ? "#ffffff" : "#0f172a",
                border: isLight ? "1px solid #e2e8f0" : "1px solid #334155",
                borderRadius: 8,
                fontSize: 12,
                color: isLight ? "#0f172a" : "#f1f5f9",
              }}
              formatter={(v, name) => {
                if (name === "staff") return [`${v} scheduled`, "Scheduled"];
                if (name === "actual") return [`${v} clocked in`, "Actual"];
                return [`${v}`, String(name)];
              }}
            />
            <Area
              type="monotone"
              dataKey="staff"
              stroke="#3b82f6"
              strokeWidth={2.5}
              fill="url(#covGrad)"
              dot={false}
            />
            {actualByPoint && (
              <Area
                type="monotone"
                dataKey="actual"
                stroke="#22c55e"
                strokeWidth={2.5}
                fill="url(#actualGrad)"
                dot={false}
                connectNulls={false}
              />
            )}
            {isToday && nowDataPoint && (
              <ReferenceLine
                x={nowDataPoint.label}
                stroke="#94a3b8"
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}
            {isToday && nowDataPoint && (
              <ReferenceDot
                x={nowDataPoint.label}
                y={nowDataPoint.actual ?? nowDataPoint.staff}
                shape={<PulsingDot color={nowDataPoint.actual != null ? "#22c55e" : "#3b82f6"} />}
              />
            )}
          </AreaChart>
        </ResponsiveContainer>

        {/* Time badge — positioned above the now line */}
        {isToday && lineLeft !== null && lineTop !== null && (
          <div
            aria-hidden="true"
            className="absolute bg-slate-800 border border-slate-700 rounded-md px-[7px] py-[2px] text-[11px] font-bold text-slate-200 whitespace-nowrap pointer-events-none -translate-x-1/2"
            style={{ left: lineLeft, top: lineTop - 24 }}
          >
            {timeStr}
          </div>
        )}
      </div>
    </motion.div>
  );
}
