"use client";
import { useMemo, useRef, useState, useEffect } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Schedule } from "../data/types";

type Props = {
  schedules: Schedule[];
  nowMinutes: number;
  isToday: boolean;
  openMinutes: number;
  closeMinutes: number;
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

// Recharts leaves ~30px for YAxis on the left and ~8px on the right
// We need to match this to position our overlay line correctly
const Y_AXIS_WIDTH = 8; // left offset (left: -28 shifts axis, net chart starts ~8px in from container left... we'll measure)
const RIGHT_PAD = 8;

export default function CoverageTimeline({
  schedules,
  nowMinutes,
  isToday,
  openMinutes,
  closeMinutes,
}: Props) {
  const range = closeMinutes - openMinutes;

  const points = useMemo(() => {
    const pts = [];
    for (let m = openMinutes; m <= closeMinutes; m += 15) {
      pts.push({ label: fmtMinutes(m), m });
    }
    return pts;
  }, [openMinutes, closeMinutes]);

  const ticks = useMemo(() => {
    const result = [];
    for (let m = openMinutes; m <= closeMinutes; m += 240) {
      result.push(fmtMinutes(m));
    }
    return result;
  }, [openMinutes, closeMinutes]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [chartRect, setChartRect] = useState<{
    left: number;
    width: number;
    top: number;
    height: number;
  } | null>(null);

  const data = useMemo(() => {
    return points.map(({ label, m }) => ({
      label,
      staff: schedules.filter(
        (s) => m >= s.startMinutes && m < s.endMinutes,
      ).length,
    }));
  }, [schedules, points]);

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

  const nowClamped = Math.min(Math.max(nowMinutes, openMinutes), closeMinutes);
  const nowPct = (nowClamped - openMinutes) / range; // 0–1
  const timeStr = fmtMinutes(nowMinutes);

  // Pixel position of the line within the container
  const lineLeft = chartRect ? chartRect.left + nowPct * chartRect.width : null;
  // Top of chart area (leave room for label above)
  const lineTop = chartRect ? chartRect.top + 28 : null; // 28 = margin.top
  const lineHeight = chartRect ? chartRect.height - 28 - 20 : null; // subtract top margin + bottom axis

  return (
    <div
      style={{
        background: "#1a2236",
        borderRadius: 16,
        padding: "16px 10px 10px",
        marginBottom: 16,
      }}
    >
      <p
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.1em",
          color: "#64748b",
          textTransform: "uppercase",
          marginBottom: 12,
          paddingLeft: 6,
        }}
      >
        Coverage Timeline
      </p>

      {/* Wrapper — position relative so overlay can be absolute */}
      <div
        ref={containerRef}
        style={{ position: "relative" }}
        onTouchEnd={() => {
          const svg = containerRef.current?.querySelector("svg");
          svg?.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));
        }}
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
            </defs>
            <XAxis
              dataKey="label"
              tick={{ fill: "#475569", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              ticks={ticks}
            />
            <YAxis
              tick={{ fill: "#475569", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 8,
                fontSize: 12,
                color: "#f1f5f9",
              }}
              formatter={(v) => [`${v} staff`, "Coverage"]}
            />
            <Area
              type="monotone"
              dataKey="staff"
              stroke="#3b82f6"
              strokeWidth={2.5}
              fill="url(#covGrad)"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>

        {/* Now line overlay — positioned absolutely over the chart */}
        {isToday &&
          lineLeft !== null &&
          lineTop !== null &&
          lineHeight !== null && (
            <div
              style={{
                position: "absolute",
                left: lineLeft,
                top: lineTop,
                width: 0,
                height: lineHeight,
                pointerEvents: "none",
              }}
            >
              {/* Dashed line */}
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  width: "1.5px",
                  height: "100%",
                  background:
                    "repeating-linear-gradient(to bottom, #94a3b8 0px, #94a3b8 4px, transparent 4px, transparent 7px)",
                }}
              />
              {/* Label badge above the line */}
              <div
                style={{
                  position: "absolute",
                  top: -24,
                  left: "50%",
                  transform: "translateX(-50%)",
                  background: "#1e293b",
                  border: "1px solid #334155",
                  borderRadius: 6,
                  padding: "2px 7px",
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#e2e8f0",
                  whiteSpace: "nowrap",
                }}
              >
                {timeStr}
              </div>
            </div>
          )}
      </div>
    </div>
  );
}
