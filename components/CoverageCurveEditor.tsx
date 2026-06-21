"use client";
import { useMemo } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { fmtMinutes } from "../data/types";
import { CoverageBlock, SLOT_MINUTES, MAX_HEADCOUNT, targetAt, curveHours } from "../lib/coverage";
import { useTheme } from "./ThemeProvider";

function minutesToTime(m: number): string {
  return `${Math.floor(m / 60).toString().padStart(2, "0")}:${(m % 60).toString().padStart(2, "0")}`;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Snap a minute value to the nearest 15-minute boundary. */
function snap(m: number): number {
  return Math.round(m / SLOT_MINUTES) * SLOT_MINUTES;
}

/** Stepped area chart of a coverage curve. */
export function CoverageCurvePreview({ blocks, height = 120 }: { blocks: CoverageBlock[]; height?: number }) {
  const { mode } = useTheme();
  const isLight = mode === "light" ||
    (mode === "system" && typeof window !== "undefined" && !window.matchMedia("(prefers-color-scheme: dark)").matches);

  const data = useMemo(() => {
    if (blocks.length === 0) return [];
    const start = Math.min(...blocks.map((b) => b.startMinutes));
    const end = Math.max(...blocks.map((b) => b.endMinutes));
    const pts: { label: string; target: number }[] = [];
    for (let m = start; m <= end; m += SLOT_MINUTES) {
      pts.push({ label: fmtMinutes(m), target: m < end ? targetAt(blocks, m) : targetAt(blocks, end - SLOT_MINUTES) });
    }
    return pts;
  }, [blocks]);

  const ticks = useMemo(() => {
    if (blocks.length === 0) return [];
    const start = Math.min(...blocks.map((b) => b.startMinutes));
    const end = Math.max(...blocks.map((b) => b.endMinutes));
    const result: string[] = [];
    for (let m = start; m <= end; m += 240) result.push(fmtMinutes(m));
    return result;
  }, [blocks]);

  if (blocks.length === 0) {
    return (
      <div className="flex items-center justify-center text-xs text-slate-500" style={{ height }}>
        No coverage blocks yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height} style={{ overflow: "visible" }}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -28, bottom: 0 }}>
        <defs>
          <linearGradient id="curvePrevGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#818cf8" stopOpacity={0.35} />
            <stop offset="95%" stopColor="#818cf8" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 10 }} tickLine={false} axisLine={false} ticks={ticks} />
        <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip
          contentStyle={{
            background: isLight ? "#ffffff" : "#0f172a",
            border: isLight ? "1px solid #e2e8f0" : "1px solid #334155",
            borderRadius: 8,
            fontSize: 12,
            color: isLight ? "#0f172a" : "#f1f5f9",
          }}
          formatter={(v) => [`${v} staff`, "Target"]}
        />
        <Area type="stepAfter" dataKey="target" stroke="#818cf8" strokeWidth={2.5} fill="url(#curvePrevGrad)" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

type EditorProps = {
  blocks: CoverageBlock[];
  onChange: (blocks: CoverageBlock[]) => void;
};

/**
 * Time-block editor for a coverage curve: each row is "from–to → N staff",
 * snapping to 15-minute intervals, with a live stepped graph above.
 */
export default function CoverageCurveEditor({ blocks, onChange }: EditorProps) {
  function updateBlock(i: number, patch: Partial<CoverageBlock>) {
    onChange(blocks.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }

  function addBlock() {
    const lastEnd = blocks.length > 0 ? Math.max(...blocks.map((b) => b.endMinutes)) : 9 * 60;
    const start = Math.min(lastEnd, 1440 - SLOT_MINUTES * 4);
    onChange([...blocks, { startMinutes: start, endMinutes: Math.min(start + 240, 1440), headcount: 2 }]);
  }

  function removeBlock(i: number) {
    onChange(blocks.filter((_, idx) => idx !== i));
  }

  const totalHours = Math.round(curveHours(blocks) * 10) / 10;

  return (
    <div>
      <CoverageCurvePreview blocks={blocks} />

      <div className="flex items-center justify-between mt-3 mb-2 px-1">
        <span className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">Coverage Blocks</span>
        <span className="text-[11px] text-indigo-400 font-bold tabular-nums">{totalHours} staff-hrs</span>
      </div>

      <div className="flex flex-col gap-2">
        {blocks.map((b, i) => (
          <div key={i} className="flex items-center gap-2 bg-bg border border-slate-800 rounded-xl px-2.5 py-2">
            <input
              type="time"
              step={SLOT_MINUTES * 60}
              value={minutesToTime(b.startMinutes)}
              aria-label={`Block ${i + 1} start time`}
              onChange={(e) => e.target.value && updateBlock(i, { startMinutes: snap(timeToMinutes(e.target.value)) })}
              className="flex-1 min-w-0 bg-card border border-slate-700 rounded-lg px-2 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500/70 transition-colors"
            />
            <span className="text-slate-500 text-xs shrink-0" aria-hidden="true">–</span>
            <input
              type="time"
              step={SLOT_MINUTES * 60}
              value={minutesToTime(b.endMinutes === 1440 ? 1439 : b.endMinutes)}
              aria-label={`Block ${i + 1} end time`}
              onChange={(e) => {
                if (!e.target.value) return;
                const m = snap(timeToMinutes(e.target.value));
                updateBlock(i, { endMinutes: m === 0 ? 1440 : m });
              }}
              className="flex-1 min-w-0 bg-card border border-slate-700 rounded-lg px-2 py-2 text-sm text-slate-100 focus:outline-none focus:border-indigo-500/70 transition-colors"
            />
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => updateBlock(i, { headcount: Math.max(0, b.headcount - 1) })}
                aria-label={`Decrease block ${i + 1} staff`}
                className="size-8 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 font-bold cursor-pointer hover:bg-slate-700 transition-colors"
              >
                −
              </button>
              <span className="w-7 text-center text-sm font-bold text-indigo-300 tabular-nums" aria-label={`Block ${i + 1} staff count`}>
                {b.headcount}
              </span>
              <button
                onClick={() => updateBlock(i, { headcount: Math.min(MAX_HEADCOUNT, b.headcount + 1) })}
                aria-label={`Increase block ${i + 1} staff`}
                className="size-8 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 font-bold cursor-pointer hover:bg-slate-700 transition-colors"
              >
                +
              </button>
            </div>
            <button
              onClick={() => removeBlock(i)}
              aria-label={`Remove block ${i + 1}`}
              className="size-8 rounded-lg bg-transparent border-none text-slate-500 cursor-pointer hover:text-red-400 transition-colors shrink-0 flex items-center justify-center"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={addBlock}
        className="w-full mt-2 py-2.5 rounded-xl bg-transparent border border-dashed border-slate-700 text-indigo-400 font-semibold text-xs cursor-pointer hover:border-indigo-500/50 hover:text-indigo-300 transition-colors"
      >
        + Add Block
      </button>
    </div>
  );
}
