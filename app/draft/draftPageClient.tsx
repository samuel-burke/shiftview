"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Employee, Schedule, fmtMinutes, formatDisplayName, getMonogram } from "../../data/types";
import { useAppData } from "../../lib/AppDataContext";
import {
  dayOfWeek,
  scheduledHoursForDate,
  shiftHours,
  weekDates,
} from "../../lib/draft-metrics";
import {
  CoverageBlock,
  CoverageDefaults,
  CoverageOverrides,
  CoverageProfile,
  coverageScoreFromCurves,
  curveForDate,
  curveHours,
  findUnderstaffedFromCurves,
} from "../../lib/coverage";
import AppShell from "../../components/AppShell";
import BottomNav from "../../components/BottomNav";
import DraftCoverageChart from "../../components/DraftCoverageChart";
import DraftBudgetChart from "../../components/DraftBudgetChart";
import DraftShiftSheet from "../../components/DraftShiftSheet";
import { createApiFetch } from "@/lib/api-fetch";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function computeWeekStart(base: Date, firstDayOfWeek: number, offsetWeeks: number): string {
  const d = new Date(base);
  const diff = (d.getDay() - firstDayOfWeek + 7) % 7;
  d.setDate(d.getDate() - diff + offsetWeeks * 7);
  return d.toLocaleDateString("en-CA");
}

function fmtShortDate(date: string): string {
  return new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Throws an Error carrying conflict metadata when the API returns a 409 conflict. */
async function throwApiError(res: Response, fallback: string): Promise<never> {
  const body = await res.json().catch(() => ({}));
  if (body.conflict) {
    throw Object.assign(new Error(body.message ?? "Conflict"), {
      conflict: body.conflict,
      window: body.window ?? null,
    });
  }
  throw new Error(body.error ?? fallback);
}

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
      transition={{ duration: 0.35, delay: index * 0.07, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="relative bg-card rounded-xl px-2 py-3 text-center overflow-hidden"
      style={{ border: `1px solid ${color}33` }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: `radial-gradient(ellipse at 50% 0%, ${color}09 0%, transparent 70%)` }}
      />
      {loading ? (
        <div className="flex justify-center mb-1">
          <div className="skeleton h-6 w-10 rounded-[6px]" />
        </div>
      ) : (
        <div className="relative flex items-baseline justify-center gap-0.5">
          <span className="text-[22px] font-extrabold leading-none tabular-nums" style={{ color }}>{value}</span>
          {suffix && <span className="text-[10px] font-bold" style={{ color }}>{suffix}</span>}
        </div>
      )}
      <div className="text-[10px] text-slate-400 mt-1 font-medium relative">{label}</div>
    </motion.div>
  );
}

export default function DraftPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isDemo = searchParams.get("demo") === "true";
  const apiFetch = createApiFetch(isDemo, () => router.push("/login"));

  const { me, storeHours, settings, sharedLoading, employees: cachedEmployees, cacheEmployees } = useAppData();
  const { isManager } = me;
  const { firstDayOfWeek } = settings;

  const [weekOffset, setWeekOffset] = useState(1); // default: next week
  const [employees, setEmployees] = useState<Employee[]>(() => cachedEmployees);
  const [drafts, setDrafts] = useState<Schedule[]>([]);
  const [profiles, setProfiles] = useState<CoverageProfile[]>([]);
  const [defaults, setDefaults] = useState<CoverageDefaults>({});
  const [overrides, setOverrides] = useState<CoverageOverrides>({});
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDayIdx, setSelectedDayIdx] = useState(0);
  const [alertsExpanded, setAlertsExpanded] = useState(false);
  const [sheet, setSheet] = useState<{ emp: Employee; draft: Schedule | null; date: string } | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<{ published: number; skipped: number } | null>(null);

  const weekStart = useMemo(
    () => computeWeekStart(new Date(), firstDayOfWeek, weekOffset),
    [firstDayOfWeek, weekOffset]
  );
  const dates = useMemo(() => weekDates(weekStart), [weekStart]);

  async function fetchDrafts(ws: string) {
    const res = await apiFetch(`/api/drafts?weekStart=${ws}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? "Failed to load draft schedule");
    }
    const data = await res.json();
    return Array.isArray(data) ? (data as Schedule[]) : [];
  }

  // Employees
  useEffect(() => {
    if (isDemo || !isManager) return;
    const controller = new AbortController();
    apiFetch("/api/employees", { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data: Employee[]) => { if (Array.isArray(data)) { setEmployees(data); cacheEmployees(data); } })
      .catch(() => {});
    return () => controller.abort();
  }, [isDemo, isManager]);

  // Coverage profiles + assignments for the visible week
  useEffect(() => {
    if (isDemo || !isManager) return;
    let cancelled = false;
    Promise.all([
      apiFetch("/api/coverage-profiles").then((r) => { if (!r.ok) throw new Error(); return r.json(); }),
      apiFetch(`/api/coverage-assignments?from=${dates[0]}&to=${dates[6]}`).then((r) => { if (!r.ok) throw new Error(); return r.json(); }),
    ])
      .then(([profilesData, assignments]) => {
        if (cancelled) return;
        if (Array.isArray(profilesData)) setProfiles(profilesData);
        setDefaults(assignments?.defaults ?? {});
        setOverrides(assignments?.overrides ?? {});
      })
      .catch(() => { if (!cancelled) setMigrationRequired(true); });
    return () => { cancelled = true; };
  }, [isDemo, isManager, weekStart]);

  // Drafts for the visible week
  useEffect(() => {
    if (isDemo || !isManager) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPublishResult(null);
    fetchDrafts(weekStart)
      .then((data) => { if (!cancelled) setDrafts(data); })
      .catch((e) => {
        if (!cancelled) {
          setDrafts([]);
          setError(e instanceof Error ? e.message : "Failed to load draft schedule");
          setMigrationRequired(true);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isDemo, isManager, weekStart]);

  // ---- Derived metrics ----
  // Target coverage curve per date (date override → day-of-week default)
  const curves = useMemo((): Record<string, CoverageBlock[]> => {
    return Object.fromEntries(dates.map((d) => [d, curveForDate(d, overrides, defaults, profiles)]));
  }, [dates, overrides, defaults, profiles]);

  // Daily/weekly budget = area under the target curve, in staff-hours
  const weeklyBudget = useMemo(
    () => dates.reduce((sum, d) => sum + curveHours(curves[d] ?? []), 0),
    [dates, curves]
  );
  const weeklyScheduled = useMemo(
    () => dates.reduce((sum, d) => sum + scheduledHoursForDate(drafts, d), 0),
    [dates, drafts]
  );
  const variance = Math.round((weeklyScheduled - weeklyBudget) * 10) / 10;
  const covScore = useMemo(
    () => coverageScoreFromCurves(drafts, dates, curves),
    [drafts, dates, curves]
  );
  const alerts = useMemo(
    () => findUnderstaffedFromCurves(drafts, dates, curves),
    [drafts, dates, curves]
  );

  const selectedDate = dates[selectedDayIdx];
  const selectedDayDrafts = useMemo(
    () => drafts
      .filter((d) => d.date.slice(0, 10) === selectedDate)
      .sort((a, b) => a.startMinutes - b.startMinutes),
    [drafts, selectedDate]
  );
  const selectedDayOff = useMemo(
    () => employees.filter((emp) => !selectedDayDrafts.some((d) => d.employeeId === emp.id)),
    [employees, selectedDayDrafts]
  );
  const empById = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);

  // ---- Mutations ----
  async function handleSaveShift(employeeId: number, draftId: number | null, startMinutes: number, endMinutes: number, override = false) {
    const res = await apiFetch("/api/drafts", {
      method: draftId ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        draftId
          ? { id: draftId, startMinutes, endMinutes, override }
          : { employeeId, date: selectedDate, startMinutes, endMinutes, override }
      ),
    });
    if (!res.ok) await throwApiError(res, "Failed to save draft shift");
    setDrafts(await fetchDrafts(weekStart));
  }

  async function handleRemoveShift(draftId: number) {
    const res = await apiFetch("/api/drafts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: draftId }),
    });
    if (!res.ok) await throwApiError(res, "Failed to remove draft shift");
    setDrafts((prev) => prev.filter((d) => d.id !== draftId));
  }

  /** Assign a profile override to a date, or clear it (null = fall back to the day-of-week default). */
  async function handleAssignProfile(date: string, profileId: number | null) {
    const res = await apiFetch("/api/coverage-assignments", {
      method: profileId === null ? "DELETE" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profileId === null ? { date } : { date, profileId }),
    });
    if (!res.ok) await throwApiError(res, "Failed to update coverage assignment");
    setOverrides((prev) => {
      const next = { ...prev };
      if (profileId === null) delete next[date];
      else next[date] = profileId;
      return next;
    });
  }

  async function handlePublish() {
    setPublishing(true);
    setError(null);
    try {
      const res = await apiFetch("/api/drafts/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekStart }),
      });
      if (!res.ok) await throwApiError(res, "Failed to publish schedule");
      const result = await res.json();
      setPublishResult(result);
      setDrafts([]);
      setConfirmPublish(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to publish schedule");
      setConfirmPublish(false);
    } finally {
      setPublishing(false);
    }
  }

  const isLoading = loading || sharedLoading;
  const weekLabel = `${fmtShortDate(dates[0])} – ${fmtShortDate(dates[6])}, ${new Date(dates[6] + "T12:00:00").getFullYear()}`;

  // ---- Non-manager / demo gates ----
  if (!sharedLoading && (!isManager || isDemo)) {
    return (
      <AppShell active="planner" isManager={isManager}>
        <main className="max-w-[480px] mx-auto pb-28 bg-bg min-h-screen flex flex-col items-center justify-center px-6 text-center [@media(min-width:900px)]:max-w-none">
          <div className="text-4xl mb-3" aria-hidden="true">🗓️</div>
          <h1 className="text-lg font-bold text-slate-100 mb-1.5">Draft Schedule</h1>
          <p className="text-sm text-slate-400">
            {isDemo ? "Draft scheduling is not available in demo mode." : "Only managers can create draft schedules."}
          </p>
          <BottomNav active="planner" />
        </main>
      </AppShell>
    );
  }

  const alertList = alerts.map((a) => ({
    key: `${a.date}-${a.startMinutes}`,
    text: `${DAY_LABELS[dayOfWeek(a.date)]} ${fmtMinutes(a.startMinutes)}–${fmtMinutes(a.endMinutes)}: Understaffed by ${a.shortfall}`,
  }));

  const publishButton = (
    <motion.button
      onClick={() => setConfirmPublish(true)}
      disabled={isLoading || drafts.length === 0}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 border-none text-white font-bold text-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition-all shrink-0"
    >
      Publish ({drafts.length})
    </motion.button>
  );

  return (
    <AppShell active="planner" isManager={isManager}>
      <main className="max-w-[480px] mx-auto pb-28 bg-bg min-h-screen [@media(min-width:900px)]:max-w-none [@media(min-width:900px)]:pb-8">
        {/* Header */}
        <div
          className="px-4 pb-3 flex items-center gap-3 border-b border-slate-800 bg-bg
                     [@media(min-width:900px)]:px-6 [@media(min-width:900px)]:py-[14px] [@media(min-width:900px)]:pb-[14px]"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}
        >
          <button
            onClick={() => router.back()}
            className="size-11 rounded-xl bg-card border border-slate-800 text-slate-400 flex items-center justify-center cursor-pointer shrink-0 hover:bg-slate-800 hover:text-slate-200 transition-colors [@media(min-width:900px)]:hidden"
            aria-label="Back"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xl font-extrabold text-slate-100 tracking-tight">Draft Schedule</span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-full px-2 py-0.5">
                Draft
              </span>
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <button
                onClick={() => setWeekOffset((w) => w - 1)}
                aria-label="Previous week"
                className="size-6 rounded-md bg-transparent border-none text-slate-400 hover:text-slate-200 cursor-pointer flex items-center justify-center"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <span className="text-xs font-semibold text-slate-400 tabular-nums">{weekLabel}</span>
              <button
                onClick={() => setWeekOffset((w) => w + 1)}
                aria-label="Next week"
                className="size-6 rounded-md bg-transparent border-none text-slate-400 hover:text-slate-200 cursor-pointer flex items-center justify-center"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              {weekOffset !== 1 && (
                <button
                  onClick={() => setWeekOffset(1)}
                  className="text-[10px] font-semibold text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer ml-1"
                >
                  Next Week
                </button>
              )}
            </div>
          </div>
          {publishButton}
        </div>

        {/* Banners */}
        {migrationRequired && (
          <div role="alert" className="mx-4 mt-3 px-4 py-3 bg-amber-500/10 border border-amber-500/25 rounded-xl text-xs text-amber-400 [@media(min-width:900px)]:mx-6">
            Database tables are missing. Run the migrations in <code className="font-mono">db/migrations/</code> (draft schedules + coverage profiles) in the Supabase SQL editor.
          </div>
        )}
        {error && !migrationRequired && (
          <div role="alert" className="mx-4 mt-3 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 text-center [@media(min-width:900px)]:mx-6">
            {error}
          </div>
        )}
        <AnimatePresence>
          {publishResult && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              role="status"
              className="mx-4 mt-3 px-4 py-3 bg-green-500/10 border border-green-500/25 rounded-xl text-sm text-green-400 text-center [@media(min-width:900px)]:mx-6"
            >
              Published {publishResult.published} shift{publishResult.published === 1 ? "" : "s"}
              {publishResult.skipped > 0 && ` · ${publishResult.skipped} skipped (already scheduled)`}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="px-4 pt-4 [@media(min-width:900px)]:grid [@media(min-width:900px)]:grid-cols-[1fr_400px] [@media(min-width:900px)]:gap-8 [@media(min-width:900px)]:px-6 [@media(min-width:900px)]:items-start">
          {/* Left column — metrics & charts */}
          <div>
            <div className="grid grid-cols-4 gap-2 mb-4">
              <StatCard index={0} value={String(Math.round(weeklyBudget))} suffix="hrs" label="Weekly Budget" color="#818cf8" loading={isLoading} />
              <StatCard index={1} value={String(Math.round(weeklyScheduled * 10) / 10)} suffix="hrs" label="Scheduled" color="#3b82f6" loading={isLoading} />
              <StatCard
                index={2}
                value={variance > 0 ? `+${variance}` : String(variance)}
                suffix="hrs"
                label="Variance"
                color={variance > 0 ? "#f87171" : variance < 0 ? "#fbbf24" : "#22c55e"}
                loading={isLoading}
              />
              <StatCard index={3} value={covScore === null ? "—" : String(covScore)} suffix={covScore === null ? undefined : "%"} label="Coverage Score" color="#22c55e" loading={isLoading} />
            </div>

            <DraftCoverageChart drafts={drafts} dates={dates} storeHours={storeHours} curves={curves} />

            {!isLoading && alertList.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-4 px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25"
              >
                {(alertsExpanded ? alertList : alertList.slice(0, 1)).map((a) => (
                  <div key={a.key} className="flex items-center gap-2 text-xs text-amber-400 py-0.5">
                    <span aria-hidden="true">⚠</span> {a.text}
                  </div>
                ))}
                {alertList.length > 1 && (
                  <button
                    onClick={() => setAlertsExpanded((v) => !v)}
                    className="text-[11px] font-semibold text-amber-300/80 hover:text-amber-200 bg-transparent border-none cursor-pointer mt-1 p-0"
                  >
                    {alertsExpanded ? "Show less" : `${alertList.length - 1} more alert${alertList.length - 1 === 1 ? "" : "s"} →`}
                  </button>
                )}
              </motion.div>
            )}

            <DraftBudgetChart
              drafts={drafts}
              dates={dates}
              curves={curves}
              isManager={isManager}
            />
          </div>

          {/* Right column — week editor */}
          <div className="[@media(min-width:900px)]:sticky [@media(min-width:900px)]:top-4">
            <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
              Schedule At a Glance
            </div>

            {/* Day chips */}
            <div className="grid grid-cols-7 gap-1 mb-3">
              {dates.map((date, i) => {
                const dayScheduled = scheduledHoursForDate(drafts, date);
                const dayBudget = curveHours(curves[date] ?? []);
                const active = i === selectedDayIdx;
                return (
                  <button
                    key={date}
                    onClick={() => setSelectedDayIdx(i)}
                    aria-pressed={active}
                    className={`flex flex-col items-center py-2 rounded-xl cursor-pointer transition-colors border ${
                      active
                        ? "bg-indigo-600/25 border-indigo-500/40 text-indigo-200"
                        : "bg-card border-slate-800/60 text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    <span className="text-[10px] font-semibold uppercase">{DAY_LABELS[dayOfWeek(date)]}</span>
                    <span className="text-sm font-bold tabular-nums">{Number(date.slice(8, 10))}</span>
                    <span
                      aria-hidden="true"
                      className={`mt-1 w-1.5 h-1.5 rounded-full ${
                        dayScheduled === 0 ? "bg-slate-700" : dayScheduled > dayBudget && dayBudget > 0 ? "bg-red-400" : "bg-green-500"
                      }`}
                    />
                  </button>
                );
              })}
            </div>

            {/* Selected day coverage profile */}
            <div className="flex items-center gap-2 mb-3 bg-card rounded-xl px-3 py-2.5 border border-white/[0.05]">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold shrink-0">Coverage</span>
              <select
                value={overrides[selectedDate] ?? ""}
                aria-label="Coverage profile for selected day"
                onChange={(e) => {
                  const v = e.target.value;
                  handleAssignProfile(selectedDate, v === "" ? null : Number(v))
                    .catch((err) => setError(err instanceof Error ? err.message : "Failed to update coverage"));
                }}
                className="flex-1 min-w-0 bg-bg border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 [color-scheme:dark] focus:outline-none focus:border-indigo-500/70 transition-colors cursor-pointer"
              >
                <option value="">
                  Default{(() => {
                    const defId = defaults[dayOfWeek(selectedDate)];
                    const name = profiles.find((p) => p.id === defId)?.name;
                    return name ? ` (${name})` : " (none)";
                  })()}
                </option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {overrides[selectedDate] !== undefined && (
                <span className="text-[9px] font-bold uppercase text-violet-300 bg-violet-500/15 border border-violet-500/25 rounded-full px-2 py-0.5 shrink-0">
                  Override
                </span>
              )}
            </div>

            {/* Selected day summary */}
            <div className="flex gap-2 mb-3">
              {(() => {
                const sch = Math.round(scheduledHoursForDate(drafts, selectedDate) * 10) / 10;
                const bud = Math.round(curveHours(curves[selectedDate] ?? []) * 10) / 10;
                const dayVar = Math.round((sch - bud) * 10) / 10;
                return [
                  { label: "Scheduled", value: `${sch} hrs`, color: "#3b82f6" },
                  { label: "Budget", value: `${bud} hrs`, color: "#818cf8" },
                  { label: "Variance", value: `${dayVar > 0 ? "+" : ""}${dayVar} hrs`, color: dayVar > 0 ? "#f87171" : dayVar < 0 ? "#fbbf24" : "#22c55e" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex-1 bg-card rounded-xl px-2 py-2 text-center border border-white/[0.05]">
                    <div className="text-xs font-bold tabular-nums" style={{ color }}>{value}</div>
                    <div className="text-[9px] text-slate-500 uppercase tracking-wider mt-0.5">{label}</div>
                  </div>
                ));
              })()}
            </div>

            {/* Employee rows for the selected day */}
            <div className="bg-card rounded-2xl border border-slate-800/60 overflow-hidden divide-y divide-slate-800/60 mb-4">
              {isLoading ? (
                <div className="p-4 flex flex-col gap-3">
                  {[0, 1, 2].map((i) => <div key={i} className="skeleton h-10 rounded-xl" />)}
                </div>
              ) : employees.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-slate-500">No employees</div>
              ) : (
                <>
                  {selectedDayDrafts.map((d) => {
                    const emp = empById.get(d.employeeId);
                    if (!emp) return null;
                    return (
                      <button
                        key={d.id}
                        onClick={() => setSheet({ emp, draft: d, date: selectedDate })}
                        className="w-full flex items-center gap-3 px-4 py-3 bg-transparent border-none cursor-pointer text-left hover:bg-slate-800/40 transition-colors"
                      >
                        <div className="size-9 rounded-full bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-xs font-bold text-blue-300 shrink-0">
                          {getMonogram(emp.name)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-slate-200 truncate">{formatDisplayName(emp.name)}</div>
                          <div className="text-xs text-slate-400 tabular-nums">
                            {fmtMinutes(d.startMinutes)} – {fmtMinutes(d.endMinutes)} · {Math.round(shiftHours(d) * 10) / 10} hrs
                          </div>
                        </div>
                        <span className="text-[10px] font-bold uppercase text-amber-400/90 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5 shrink-0">
                          Draft
                        </span>
                      </button>
                    );
                  })}
                  {selectedDayOff.map((emp) => (
                    <button
                      key={emp.id}
                      onClick={() => setSheet({ emp, draft: null, date: selectedDate })}
                      className="w-full flex items-center gap-3 px-4 py-3 bg-transparent border-none cursor-pointer text-left hover:bg-slate-800/40 transition-colors"
                    >
                      <div className="size-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-bold text-slate-500 shrink-0">
                        {getMonogram(emp.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-slate-400 truncate">{formatDisplayName(emp.name)}</div>
                        <div className="text-xs text-slate-600">Off</div>
                      </div>
                      <span className="text-[11px] font-semibold text-indigo-400 shrink-0">+ Add</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        </div>

        <DraftShiftSheet
          open={!!sheet}
          employee={sheet?.emp ?? null}
          draft={sheet?.draft ?? null}
          date={sheet?.date ?? selectedDate}
          onClose={() => setSheet(null)}
          onSave={handleSaveShift}
          onRemove={handleRemoveShift}
        />

        {/* Publish confirmation */}
        <AnimatePresence>
          {confirmPublish && (
            <motion.div
              key="publish-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-0 z-[60] flex items-center justify-center px-4"
              style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
              onClick={() => !publishing && setConfirmPublish(false)}
            >
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-labelledby="publish-modal-title"
                initial={{ scale: 0.94, opacity: 0, y: 8 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.96, opacity: 0, y: 4 }}
                transition={{ type: "spring", stiffness: 380, damping: 28 }}
                className="w-full max-w-[360px] bg-card border border-slate-700 rounded-2xl overflow-hidden"
                style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)" }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-5 pt-5 pb-4 flex flex-col items-center text-center gap-3">
                  <div className="size-12 rounded-full bg-blue-500/15 border border-blue-500/25 flex items-center justify-center text-2xl" aria-hidden="true">
                    📣
                  </div>
                  <div>
                    <div id="publish-modal-title" className="text-base font-bold text-slate-100">Publish Week?</div>
                    <div className="text-sm text-slate-400 mt-1.5">
                      {drafts.length} draft shift{drafts.length === 1 ? "" : "s"} for {weekLabel} will go live and employees will be notified.
                    </div>
                  </div>
                </div>
                <div className="flex border-t border-slate-800">
                  <button
                    onClick={() => setConfirmPublish(false)}
                    disabled={publishing}
                    autoFocus
                    className="flex-1 py-3.5 text-sm font-semibold text-slate-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border-r border-slate-800 bg-transparent border-t-0 border-l-0 border-b-0 hover:bg-slate-800/50 hover:text-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handlePublish}
                    disabled={publishing}
                    aria-busy={publishing}
                    className="flex-1 py-3.5 text-sm font-bold text-blue-400 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-transparent border-none hover:text-blue-300 hover:bg-blue-500/10"
                  >
                    {publishing ? "Publishing…" : "Publish"}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <BottomNav active="planner" />
      </main>
    </AppShell>
  );
}
