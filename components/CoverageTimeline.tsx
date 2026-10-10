"use client";
import { memo, useMemo, useRef, useState, useEffect, useLayoutEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ReferenceDot,
  ResponsiveContainer,
} from "recharts";
import { Schedule, PunchRecord, isHere } from "../data/types";
import { CoverageBlock, targetAt } from "../lib/coverage";
import { useTheme } from "./ThemeProvider";
import { DEFAULT_TIMEZONE, getLocalMinutes } from "@/lib/dates";

type Props = {
  schedules: Schedule[];
  // The day being charted; shifts from the day before (overnight) are placed
  // relative to it.
  dayKey?: string;
  nowMinutes: number;
  isToday: boolean;
  openMinutes: number;
  closeMinutes: number;
  punchRecords?: PunchRecord[];
  punchesLoaded?: boolean;
  timezone?: string;
  targetBlocks?: CoverageBlock[];
};

function fmtMinutes(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  const ampm = h % 24 >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return min === 0
    ? `${h12}:00 ${ampm}`
    : `${h12}:${String(min).padStart(2, "0")} ${ampm}`;
}

// The "now" dot. Its pulse is drawn by the chart as an HTML ring (.now-pulse)
// rather than an SVG animation: animating the ring inside the SVG repainted
// the whole chart every frame for as long as the dashboard was open, while a
// CSS transform/opacity animation runs on the compositor. The dot reports its
// position (in SVG coordinates) so the ring can sit on it.
function NowDot({ cx, cy, color = "#22c55e", onPlace }: {
  cx?: number;
  cy?: number;
  color?: string;
  onPlace?: (at: { x: number; y: number } | null) => void;
}) {
  useLayoutEffect(() => {
    onPlace?.(cx === undefined || cy === undefined ? null : { x: cx, y: cy });
    return () => onPlace?.(null);
  }, [cx, cy, onPlace]);
  if (cx === undefined || cy === undefined) return null;
  return <circle aria-hidden="true" cx={cx} cy={cy} r={4} fill={color} />;
}

// Recharts' plot area starts this far into the SVG (margin left = -28).
const PLOT_LEFT = 30;

function CoverageTimeline({
  schedules,
  dayKey,
  nowMinutes,
  isToday,
  openMinutes,
  closeMinutes,
  punchRecords,
  punchesLoaded = false,
  timezone = DEFAULT_TIMEZONE,
  targetBlocks,
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
  // Renders as soon as today's punches are loaded — even with nobody clocked in
  // yet — so the "here now" line shows a flat zero rather than disappearing.
  const actualByPoint = useMemo(() => {
    if (!isToday || !punchesLoaded) return null;

    // getLocalMinutes uses a 0–23 hour cycle; `hour12: false` formatting can
    // report midnight as hour "24" and push early punches off the chart.
    const withMinutes = (punchRecords ?? []).map((p) => ({
      ...p,
      minuteOfDay: getLocalMinutes(p.punchedAt, timezone),
    }));

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
  }, [isToday, punchesLoaded, punchRecords, points, nowMinutes, timezone]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [showTooltip, setShowTooltip] = useState(true);
  // The curves draw in once. After that — switching days, the minute tick,
  // live punches — they update in place: re-running the 1.5s animation on each
  // change kept a phone's main thread busy for over a second after every tap.
  const reduceMotion = useReducedMotion();
  const [drawnIn, setDrawnIn] = useState(false);
  const animate = !drawnIn && !reduceMotion;
  const onDrawnIn = () => setDrawnIn(true);
  const [dotAt, setDotAt] = useState<{ x: number; y: number } | null>(null);
  const [chartRect, setChartRect] = useState<{
    svgLeft: number;
    left: number;
    width: number;
    top: number;
    height: number;
    containerWidth: number;
  } | null>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const [badgeWidth, setBadgeWidth] = useState(0);

  const hasTarget = !!targetBlocks && targetBlocks.length > 0;

  const data = useMemo(() => {
    return points.map(({ label, m }, i) => ({
      label,
      staff: schedules.filter((s) => isHere(s, m, dayKey)).length,
      actual: actualByPoint ? actualByPoint[i] : undefined,
      target: hasTarget ? targetAt(targetBlocks!, Math.min(m, closeMinutes - 1)) : undefined,
    }));
  }, [schedules, dayKey, points, actualByPoint, hasTarget, targetBlocks, closeMinutes]);

  const nowDataPoint = useMemo(() => {
    if (!isToday) return null;
    const clampedM = Math.min(Math.max(nowMinutes, openMinutes), closeMinutes);
    const label = fmtMinutes(clampedM);
    const staff = schedules.filter((s) => isHere(s, clampedM, dayKey)).length;
    const idx = points.findIndex((p) => p.m === clampedM);
    const actual = actualByPoint && idx >= 0 ? actualByPoint[idx] : null;
    return { label, staff, actual };
  }, [isToday, nowMinutes, openMinutes, closeMinutes, schedules, dayKey, points, actualByPoint]);

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
      const plotRight = 8;
      setChartRect({
        svgLeft: svgRect.left - elRect.left,
        left: svgRect.left - elRect.left + PLOT_LEFT,
        width: svgRect.width - PLOT_LEFT - plotRight,
        top: svgRect.top - elRect.top,
        height: svgRect.height,
        containerWidth: elRect.width,
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

  const timeStr = fmtMinutes(nowMinutes);

  // The badge's width depends on the time and the font, so measure it (before
  // paint) to keep it inside the chart below.
  useLayoutEffect(() => {
    if (badgeRef.current) setBadgeWidth(badgeRef.current.offsetWidth);
  }, [timeStr, chartRect]);

  if (range === 0) return null;

  const nowDotColor = nowDataPoint?.actual != null ? "#22c55e" : "#3b82f6";

  const nowPct = (Math.min(Math.max(nowMinutes, openMinutes), closeMinutes) - openMinutes) / range; // 0–1
  // Pixel position of the badge within the container
  const lineLeft = chartRect ? chartRect.left + nowPct * chartRect.width : null;
  const lineTop = chartRect ? chartRect.top + 28 : null; // 28 = margin.top
  // Centred on the now line, but held inside the chart: before opening and
  // after closing the line sits at an edge, and a centred badge would hang
  // off the card (on a phone, off the screen).
  const badgeLeft = chartRect && lineLeft !== null
    ? Math.min(Math.max(lineLeft, badgeWidth / 2), chartRect.containerWidth - badgeWidth / 2)
    : null;

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
          {hasTarget && (
            <motion.span
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1, duration: 0.25 }}
              className="flex items-center gap-1.5 text-[10px] text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded-full border border-slate-700/40"
            >
              <span
                className="inline-block w-2.5 h-0.5 rounded-full"
                style={{ backgroundImage: "repeating-linear-gradient(90deg, #818cf8 0 3px, transparent 3px 5px)" }}
              />
              Target
            </motion.span>
          )}
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
        /*
         * Height from CSS, so it's right in the server HTML (no layout jump):
         * 3:1 with the width, at least 150px (the phone size) and at most 300px.
         */
        className="relative w-full min-w-0 aspect-[3/1] min-h-[150px] max-h-[300px]"
        onTouchStart={() => setShowTooltip(true)}
        onTouchEnd={() => setShowTooltip(false)}
        onTouchCancel={() => setShowTooltip(false)}
      >
        <ResponsiveContainer
          width="100%"
          height="100%"
          style={{ overflow: "visible" }}
        >
          <ComposedChart
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
                if (name === "target") return [`${v} target`, "Target"];
                return [`${v}`, String(name)];
              }}
            />
            {hasTarget && (
              <Line
                type="stepAfter"
                dataKey="target"
                stroke="#818cf8"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={false}
                activeDot={false}
                isAnimationActive={animate}
              />
            )}
            <Area
              type="monotone"
              dataKey="staff"
              stroke="#3b82f6"
              strokeWidth={2.5}
              fill="url(#covGrad)"
              dot={false}
              isAnimationActive={animate}
              onAnimationEnd={onDrawnIn}
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
                isAnimationActive={animate}
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
                shape={<NowDot color={nowDotColor} onPlace={setDotAt} />}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>

        {isToday && nowDataPoint && dotAt && chartRect && (
          <span
            aria-hidden="true"
            className="now-pulse"
            style={{ left: chartRect.svgLeft + dotAt.x, top: chartRect.top + dotAt.y, borderColor: nowDotColor }}
          />
        )}

        {/* Time badge — positioned above the now line */}
        {isToday && badgeLeft !== null && lineTop !== null && (
          <div
            ref={badgeRef}
            data-testid="now-badge"
            aria-hidden="true"
            className="absolute bg-slate-800 border border-slate-700 rounded-md px-[7px] py-[2px] text-[11px] font-bold text-slate-200 whitespace-nowrap pointer-events-none -translate-x-1/2"
            style={{ left: badgeLeft, top: lineTop - 24 }}
          >
            {timeStr}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// Memoized: the dashboard re-renders for things the chart doesn't show (the
// employee drawer opening, the export panel), and redrawing Recharts is the
// most expensive part of that render.
export default memo(CoverageTimeline);
