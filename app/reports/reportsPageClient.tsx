"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import BottomNav from "../../components/BottomNav";

type DayCount = { date: string; count: number };
type Employee = { id: number; name: string };
type Schedule = { id: number; employeeId: number; date: string; startMinutes: number; endMinutes: number };

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function subtractDays(dateStr: string, days: number): string {
  return addDays(dateStr, -days);
}

function toDateKey(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "UTC" });
}

function getWeekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

function formatDateShort(dateStr: string): string {
  return new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "UTC",
  });
}

function formatWeekLabel(weekStart: string): string {
  const end = addDays(weekStart, 6);
  const startLabel = new Date(weekStart + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const endLabel = new Date(end + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `${startLabel} – ${endLabel}`;
}

function cellClass(count: number, min: number, optimal: number) {
  if (count >= optimal) return "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30";
  if (count >= min)     return "bg-amber-500/20  text-amber-400  border border-amber-500/30";
  if (count > 0)        return "bg-red-500/20    text-red-400    border border-red-500/30";
  return "bg-slate-800 text-slate-600 border border-slate-700";
}

export default function ReportsPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isDemo = searchParams.get("demo") === "true";

  const today = new Date();
  const todayKey = toDateKey(today);

  const [loading, setLoading] = useState(true);
  const [coverageDays, setCoverageDays] = useState<DayCount[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [optimalCoverage, setOptimalCoverage] = useState(3);
  const [minCoverage, setMinCoverage] = useState(2);
  const [firstDayOfWeek, setFirstDayOfWeek] = useState(6);

  // Week selector: start from 3 weeks ago
  const [weekOffset, setWeekOffset] = useState(0);

  // Per-employee hours for selected week
  const [weekSchedules, setWeekSchedules] = useState<Schedule[]>([]);
  const [weekLoading, setWeekLoading] = useState(false);

  // Calculate week start for selected week
  const selectedWeekStart = useMemo(() => {
    // Get Sunday/Monday/Saturday base of this week using firstDayOfWeek
    const base = new Date(todayKey + "T12:00:00Z");
    const dayOfWeek = base.getUTCDay();
    const diff = (dayOfWeek - firstDayOfWeek + 7) % 7;
    const weekBase = addDays(todayKey, -diff);
    return addDays(weekBase, weekOffset * 7);
  }, [todayKey, firstDayOfWeek, weekOffset]);

  useEffect(() => {
    // Check manager
    fetch(`/api/me${isDemo ? "?demo=true" : ""}`)
      .then((r) => r.json())
      .then(({ isManager }) => {
        if (!isManager) router.replace("/");
      })
      .catch(() => {});

    fetch(`/api/employees${isDemo ? "?demo=true" : ""}`)
      .then((r) => r.json())
      .then(setEmployees)
      .catch(() => {});

    fetch("/api/settings")
      .then((r) => r.json())
      .then(({ optimalCoverage: oc, minCoverage: mc, firstDayOfWeek: fdw }) => {
        if (oc != null) setOptimalCoverage(oc);
        if (mc != null) setMinCoverage(mc);
        if (fdw != null) setFirstDayOfWeek(fdw);
      })
      .catch(() => {});

    // Fetch 4 weeks of coverage
    const from = subtractDays(todayKey, 27);
    fetch(`/api/reports/coverage?from=${from}&to=${todayKey}`)
      .then((r) => r.json())
      .then(({ days }) => {
        setCoverageDays(days ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Fetch week schedules when selected week changes
  useEffect(() => {
    const weekDates = getWeekDates(selectedWeekStart);
    setWeekLoading(true);
    Promise.allSettled(
      weekDates.map((d) =>
        fetch(`/api/schedules?date=${d}${isDemo ? "&demo=true" : ""}`)
          .then((r) => r.json())
          .then((data: any[]) => data.map((s: any) => ({
            id: s.id,
            employeeId: s.employeeId,
            date: s.date,
            startMinutes: s.startMinutes,
            endMinutes: s.endMinutes,
          })))
      )
    ).then((results) => {
      const all: Schedule[] = [];
      for (const r of results) {
        if (r.status === "fulfilled") all.push(...r.value);
      }
      setWeekSchedules(all);
      setWeekLoading(false);
    });
  }, [selectedWeekStart]);

  // Build 4-week heatmap grid (28 days)
  const heatmapDays = useMemo(() => {
    const from = subtractDays(todayKey, 27);
    return Array.from({ length: 28 }, (_, i) => addDays(from, i));
  }, [todayKey]);

  const coverageMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of coverageDays) m[d.date] = d.count;
    return m;
  }, [coverageDays]);

  // Per-employee hours for selected week
  const weekDates = useMemo(() => getWeekDates(selectedWeekStart), [selectedWeekStart]);

  const employeeHours = useMemo(() => {
    const map: Record<number, Record<string, number>> = {};
    for (const s of weekSchedules) {
      if (!map[s.employeeId]) map[s.employeeId] = {};
      map[s.employeeId][s.date.slice(0, 10)] = (map[s.employeeId][s.date.slice(0, 10)] ?? 0) + (s.endMinutes - s.startMinutes) / 60;
    }
    return map;
  }, [weekSchedules, weekDates]);

  function exportCSV() {
    const rows: string[][] = [];
    // Header
    rows.push(["Employee", ...weekDates.map(formatDateShort), "Total"]);
    for (const emp of employees) {
      const dayHours = weekDates.map((d) => {
        const h = employeeHours[emp.id]?.[d];
        return h !== undefined ? h.toFixed(1) : "0";
      });
      const total = dayHours.reduce((a, b) => a + parseFloat(b), 0).toFixed(1);
      rows.push([emp.name, ...dayHours, total]);
    }
    // Coverage row
    const coverageRow = ["Coverage", ...weekDates.map((d) => String(coverageMap[d] ?? 0)), ""];
    rows.push(coverageRow);

    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shift-report-${selectedWeekStart}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="max-w-[480px] mx-auto pb-28 bg-bg min-h-screen">
      {/* Top bar */}
      <div
        className="px-4 pb-3 flex items-center gap-3 border-b border-slate-800 bg-bg"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}
      >
        <button
          onClick={() => router.back()}
          className="size-9 rounded-xl bg-card border border-slate-800 text-slate-400 flex items-center justify-center text-xl cursor-pointer shrink-0"
          aria-label="Back"
        >
          ‹
        </button>
        <span className="text-2xl font-extrabold text-slate-100 tracking-tight">Reports</span>
      </div>

      <div className="px-4 pt-5 flex flex-col gap-5">

        {/* Coverage heatmap */}
        <section>
          <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
            Coverage — Last 4 Weeks
          </div>
          {loading ? (
            <div className="h-28 bg-slate-800 rounded-2xl animate-pulse" />
          ) : (
            <div className="bg-card rounded-2xl border border-slate-800/60 p-3">
              {/* Day labels */}
              <div className="grid grid-cols-7 gap-1 mb-1">
                {["S","M","T","W","T","F","S"].map((d, i) => (
                  <div key={i} className="text-center text-[10px] text-slate-500 font-semibold">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {heatmapDays.map((day) => {
                  const count = coverageMap[day] ?? 0;
                  const cls = cellClass(count, minCoverage, optimalCoverage);
                  return (
                    <div key={day} className={`rounded-lg py-2 flex flex-col items-center justify-center ${cls}`}>
                      <span className="text-[11px] font-bold tabular-nums">{count}</span>
                      <span className="text-[9px] mt-0.5 opacity-70">
                        {new Date(day + "T12:00:00Z").getUTCDate()}
                      </span>
                    </div>
                  );
                })}
              </div>
              {/* Legend */}
              <div className="flex gap-3 mt-2 justify-center">
                {[
                  { label: "Optimal", cls: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" },
                  { label: "Low", cls: "bg-amber-500/20 text-amber-400 border border-amber-500/30" },
                  { label: "Critical", cls: "bg-red-500/20 text-red-400 border border-red-500/30" },
                  { label: "None", cls: "bg-slate-800 text-slate-600 border border-slate-700" },
                ].map(({ label, cls }) => (
                  <div key={label} className="flex items-center gap-1">
                    <div className={`size-3 rounded ${cls}`} />
                    <span className="text-[10px] text-slate-400">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* Week selector + hours table */}
        <section>
          <div className="flex items-center justify-between mb-2 px-1">
            <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">
              Hours — {formatWeekLabel(selectedWeekStart)}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setWeekOffset((o) => o - 1)} className="size-7 rounded-lg bg-card border border-slate-800 text-slate-400 flex items-center justify-center cursor-pointer text-sm">‹</button>
              {weekOffset !== 0 && (
                <button onClick={() => setWeekOffset(0)} className="text-[11px] text-slate-400 bg-card border border-slate-800 rounded-lg px-2 py-1 cursor-pointer">Now</button>
              )}
              <button onClick={() => setWeekOffset((o) => o + 1)} className="size-7 rounded-lg bg-card border border-slate-800 text-slate-400 flex items-center justify-center cursor-pointer text-sm">›</button>
            </div>
          </div>

          {weekLoading ? (
            <div className="h-32 bg-slate-800 rounded-2xl animate-pulse" />
          ) : (
            <div className="bg-card rounded-2xl border border-slate-800/60 overflow-hidden">
              {/* Day headers */}
              <div className="grid grid-cols-[1fr_repeat(7,minmax(0,1fr))_auto] gap-1 px-3 py-2 border-b border-slate-800/60 bg-slate-800/30">
                <div className="text-[10px] text-slate-500 font-semibold">Employee</div>
                {weekDates.map((d) => (
                  <div key={d} className="text-[10px] text-slate-500 font-semibold text-center">
                    {new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "narrow", timeZone: "UTC" })}
                  </div>
                ))}
                <div className="text-[10px] text-slate-500 font-semibold text-right">Tot</div>
              </div>
              {employees.length === 0 ? (
                <div className="px-3 py-4 text-center text-sm text-slate-500">No employees</div>
              ) : (
                employees.map((emp) => {
                  const total = weekDates.reduce((sum, d) => sum + (employeeHours[emp.id]?.[d] ?? 0), 0);
                  return (
                    <div key={emp.id} className="grid grid-cols-[1fr_repeat(7,minmax(0,1fr))_auto] gap-1 px-3 py-2 border-b border-slate-800/60 last:border-b-0">
                      <div className="text-xs text-slate-200 font-medium truncate">{emp.name.split(" ")[0]}</div>
                      {weekDates.map((d) => {
                        const h = employeeHours[emp.id]?.[d];
                        return (
                          <div key={d} className={`text-center text-[11px] font-semibold tabular-nums rounded px-0.5 ${h ? "text-indigo-300" : "text-slate-700"}`}>
                            {h ? h.toFixed(0) : "-"}
                          </div>
                        );
                      })}
                      <div className="text-right text-[11px] font-bold text-slate-300 tabular-nums">
                        {total > 0 ? total.toFixed(0) : "-"}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </section>

        {/* CSV Export */}
        <section>
          <button
            onClick={exportCSV}
            className="w-full py-3 rounded-2xl bg-gradient-to-r from-blue-500 to-violet-500 text-white font-bold text-sm cursor-pointer"
          >
            Export CSV
          </button>
        </section>

      </div>

      <BottomNav active="team" />
    </main>
  );
}
