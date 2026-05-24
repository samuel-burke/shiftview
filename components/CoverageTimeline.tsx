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

type Props = { schedules: Schedule[]; nowMinutes: number; isToday: boolean };

const START_M = 360; // 6AM
const END_M = 1320; // 10PM
const RANGE = END_M - START_M;

const POINTS = [
  { label: "6:00AM", m: 360 },
  { label: "6:30AM", m: 390 },
  { label: "7:00AM", m: 420 },
  { label: "7:30AM", m: 450 },
  { label: "8:00AM", m: 480 },
  { label: "8:30AM", m: 510 },
  { label: "9:00AM", m: 540 },
  { label: "9:30AM", m: 570 },
  { label: "10:00AM", m: 600 },
  { label: "10:30AM", m: 630 },
  { label: "11:00AM", m: 660 },
  { label: "11:30AM", m: 690 },
  { label: "12:00PM", m: 720 },
  { label: "12:30PM", m: 750 },
  { label: "1:00PM", m: 780 },
  { label: "1:30PM", m: 810 },
  { label: "2:00PM", m: 840 },
  { label: "2:30PM", m: 870 },
  { label: "3:00PM", m: 900 },
  { label: "3:30PM", m: 930 },
  { label: "4:00PM", m: 960 },
  { label: "4:30PM", m: 990 },
  { label: "5:00PM", m: 1020 },
  { label: "5:30PM", m: 1050 },
  { label: "6:00PM", m: 1080 },
  { label: "6:30PM", m: 1110 },
  { label: "7:00PM", m: 1140 },
  { label: "7:30PM", m: 1170 },
  { label: "8:00PM", m: 1200 },
  { label: "8:30PM", m: 1230 },
  { label: "9:00PM", m: 1260 },
  { label: "9:30PM", m: 1290 },
  { label: "10:00PM", m: 1320 },
];

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
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [chartRect, setChartRect] = useState<{
    left: number;
    width: number;
    top: number;
    height: number;
  } | null>(null);

  const data = useMemo(() => {
    return POINTS.map(({ label, m }) => ({
      label,
      staff: schedules.filter(
        (s) => s.startMinutes >= 0 && m >= s.startMinutes && m < s.endMinutes,
      ).length,
    }));
  }, [schedules]);

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

  const nowClamped = Math.min(Math.max(nowMinutes, START_M), END_M);
  const nowPct = (nowClamped - START_M) / RANGE; // 0–1
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
        Today's Coverage Timeline
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
              ticks={["6:00AM", "10:00AM", "2:00PM", "6:00PM", "10:00PM"]}
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
