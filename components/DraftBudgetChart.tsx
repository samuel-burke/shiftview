"use client";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Schedule, StoreHours } from "../data/types";
import { dayOfWeek, scheduledHoursForDate } from "../lib/draft-metrics";
import { useTheme } from "./ThemeProvider";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Props = {
  drafts: Schedule[];
  dates: string[]; // 7 YYYY-MM-DD dates
  budgets: Record<number, number>; // dayOfWeek -> budget hours
  storeHours: Record<number, StoreHours>;
  isManager: boolean;
  onSaveBudget: (dow: number, budgetHours: number) => Promise<void>;
};

export default function DraftBudgetChart({ drafts, dates, budgets, isManager, onSaveBudget }: Props) {
  const { mode } = useTheme();
  const isLight = mode === "light" ||
    (mode === "system" && typeof window !== "undefined" && !window.matchMedia("(prefers-color-scheme: dark)").matches);
  const [editing, setEditing] = useState(false);
  const [draftBudgets, setDraftBudgets] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const data = useMemo(
    () => dates.map((date) => {
      const dow = dayOfWeek(date);
      const scheduled = Math.round(scheduledHoursForDate(drafts, date) * 10) / 10;
      const budget = budgets[dow] ?? 0;
      return { label: DAY_LABELS[dow], dow, budget, scheduled, variance: Math.round((scheduled - budget) * 10) / 10 };
    }),
    [dates, drafts, budgets]
  );

  function startEditing() {
    setDraftBudgets(Object.fromEntries(data.map((d) => [d.dow, String(budgets[d.dow] ?? 0)])));
    setError(null);
    setEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      for (const d of data) {
        const next = parseInt(draftBudgets[d.dow] || "0", 10);
        if (Number.isNaN(next) || next < 0) throw new Error(`Invalid budget for ${d.label}`);
        if (next !== (budgets[d.dow] ?? 0)) await onSaveBudget(d.dow, next);
      }
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save budgets");
    } finally {
      setSaving(false);
    }
  }

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
        {isManager && !editing && (
          <button
            onClick={startEditing}
            className="text-[10px] font-semibold text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer transition-colors"
          >
            Edit Budgets
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 mb-3 pl-1.5">
        <span className="flex items-center gap-1.5 text-[10px] text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded-full border border-slate-700/40">
          <span className="inline-block w-2 h-2 rounded-[3px] bg-slate-500" />
          Budget
        </span>
        <span className="flex items-center gap-1.5 text-[10px] text-slate-400 bg-slate-800/60 px-2 py-0.5 rounded-full border border-slate-700/40">
          <span className="inline-block w-2 h-2 rounded-[3px] bg-blue-500" />
          Scheduled
        </span>
      </div>

      {editing ? (
        <div className="px-1.5 pb-2">
          <div className="grid grid-cols-7 gap-1.5">
            {data.map((d) => (
              <div key={d.dow} className="flex flex-col items-center gap-1">
                <label htmlFor={`budget-${d.dow}`} className="text-[10px] text-slate-400 font-semibold">{d.label}</label>
                <input
                  id={`budget-${d.dow}`}
                  type="number"
                  min={0}
                  max={999}
                  inputMode="numeric"
                  value={draftBudgets[d.dow] ?? ""}
                  onChange={(e) => setDraftBudgets((prev) => ({ ...prev, [d.dow]: e.target.value }))}
                  className="w-full bg-bg border border-slate-700 rounded-lg px-1 py-2 text-center text-sm text-slate-100 [color-scheme:dark] focus:outline-none focus:border-indigo-500/70 transition-colors"
                />
              </div>
            ))}
          </div>
          {error && <div role="alert" className="text-xs text-red-400 text-center mt-2">{error}</div>}
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleSave}
              disabled={saving}
              aria-busy={saving}
              className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 border-none text-white font-bold text-xs cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed hover:brightness-110 transition-all"
            >
              {saving ? "Saving…" : "Save Budgets"}
            </button>
            <button
              onClick={() => { setEditing(false); setError(null); }}
              disabled={saving}
              className="px-4 py-2.5 rounded-xl bg-transparent border border-slate-700 text-slate-400 font-semibold text-xs cursor-pointer hover:text-slate-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={170} style={{ overflow: "visible" }}>
            <BarChart data={data} margin={{ top: 12, right: 8, left: -28, bottom: 0 }} barGap={2}>
              <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 10 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
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

          {/* Per-day variance strip */}
          <div className="grid grid-cols-7 gap-1 px-1.5 mt-1" aria-label="Daily variance (scheduled minus budget)">
            {data.map((d) => (
              <div
                key={d.dow}
                className={`text-center text-[10px] font-bold tabular-nums ${
                  d.variance > 0 ? "text-red-400" : d.variance < 0 ? "text-amber-400" : "text-green-500"
                }`}
              >
                {d.variance > 0 ? `+${d.variance}` : d.variance}
              </div>
            ))}
          </div>
        </>
      )}
    </motion.div>
  );
}
