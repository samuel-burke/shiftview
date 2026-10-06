"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
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
import DraftShiftSheet from "../../components/DraftShiftSheet";
import AutoScheduleSheet, { type GenerateRequest, type PlannerEmployee } from "../../components/AutoScheduleSheet";
import AutoScheduleSummary, { type SummaryBusy } from "../../components/AutoScheduleSummary";
import WeekCoverageHeatmap from "../../components/WeekCoverageHeatmap";
import DraftHoursPanel from "../../components/DraftHoursPanel";
import { limitsFromColumns, type EmploymentType } from "../../lib/scheduling-rules";
import { scheduledMinutesByEmployee } from "../../lib/schedule-hours";
import type { Adjustment, GenerationRun, Suggestion } from "../../lib/scheduler/types";
import { createApiFetch } from "@/lib/api-fetch";
import { addDaysToKey, formatDateKey, weekStartForKey } from "@/lib/dates";
import { useStoreTodayKey } from "@/hooks/useStoreTodayKey";

// recharts is heavy; code-split both planner charts out of the route's
// initial bundle. They render below the stats and don't need to be in the
// critical path, so a lightweight placeholder while the chunk loads is fine.
const chartPlaceholder = () => <div className="h-[200px]" aria-hidden="true" />;
const DraftCoverageChart = dynamic(() => import("../../components/DraftCoverageChart"), {
  ssr: false,
  loading: chartPlaceholder,
});
const DraftBudgetChart = dynamic(() => import("../../components/DraftBudgetChart"), {
  ssr: false,
  loading: chartPlaceholder,
});

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function computeWeekStart(todayKey: string, firstDayOfWeek: number, offsetWeeks: number): string {
  return addDaysToKey(weekStartForKey(todayKey, firstDayOfWeek), offsetWeeks * 7);
}

function fmtShortDate(date: string): string {
  return formatDateKey(date, { month: "short", day: "numeric" });
}

/** The week's latest Auto-schedule run that is still in effect, or null. */
async function fetchLatestRun(weekStart: string): Promise<GenerationRun | null> {
  const res = await fetch(`/api/drafts/generate?weekStart=${weekStart}`).catch(() => null);
  if (!res?.ok) return null;
  const body = await res.json().catch(() => null);
  return body?.run ?? null;
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
          {suffix && <span className="text-[11px] font-bold" style={{ color }}>{suffix}</span>}
        </div>
      )}
      <div className="text-[11px] text-slate-400 mt-1 font-medium relative">{label}</div>
    </motion.div>
  );
}

export default function DraftPageClient() {
  const router = useRouter();
  const apiFetch = createApiFetch(() => router.push("/login"));

  const { me, storeHours, settings, sharedLoading, employees: cachedEmployees, cacheEmployees } = useAppData();
  const { isManager } = me;
  const { firstDayOfWeek, timezone } = settings;
  const todayKey = useStoreTodayKey(timezone);

  const [weekOffset, setWeekOffset] = useState(1); // default: next week
  const [employees, setEmployees] = useState<PlannerEmployee[]>(() => cachedEmployees);
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
  // Auto-schedule: the week's latest run (kept with its week, so changing
  // weeks never shows another week's run), the sheet, and request state.
  const [run, setRun] = useState<GenerationRun | null>(null);
  const [dismissedRunId, setDismissedRunId] = useState<number | null>(null);
  const [autoOpen, setAutoOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [autoError, setAutoError] = useState<string | null>(null);
  const [summaryBusy, setSummaryBusy] = useState<SummaryBusy>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const weekStart = useMemo(
    () => computeWeekStart(todayKey, firstDayOfWeek, weekOffset),
    [todayKey, firstDayOfWeek, weekOffset]
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
    if (!isManager) return;
    const controller = new AbortController();
    apiFetch("/api/employees", { signal: controller.signal })
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data: PlannerEmployee[]) => { if (Array.isArray(data)) { setEmployees(data); cacheEmployees(data); } })
      .catch(() => {});
    return () => controller.abort();
  }, [isManager]);

  // Coverage profiles + assignments for the visible week
  useEffect(() => {
    if (!isManager) return;
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
  }, [isManager, weekStart]);

  // Drafts for the visible week
  useEffect(() => {
    if (!isManager) { setLoading(false); return; }
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
  }, [isManager, weekStart]);

  // The week's latest Auto-schedule run still in effect, if any.
  useEffect(() => {
    if (!isManager) return;
    let cancelled = false;
    fetchLatestRun(weekStart).then((latest) => { if (!cancelled) setRun(latest); });
    return () => { cancelled = true; };
  }, [isManager, weekStart]);
  const currentRun = run?.weekStart === weekStart ? run : null;

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
    () => dates.reduce((sum, d) => sum + scheduledHoursForDate(drafts, d, timezone), 0),
    [dates, drafts, timezone]
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

  // ---- Auto-schedule ----
  async function requestGeneration(body: Record<string, unknown>): Promise<GenerationRun> {
    const res = await apiFetch("/api/drafts/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekStart, ...body }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "Couldn't generate a schedule");
    return json.run as GenerationRun;
  }

  async function handleGenerate(request: GenerateRequest) {
    setGenerating(true);
    setAutoError(null);
    try {
      const next = await requestGeneration({ ...request });
      setRun(next);
      setSummaryError(null);
      setDrafts(await fetchDrafts(weekStart));
      setAutoOpen(false);
    } catch (e) {
      setAutoError(e instanceof Error ? e.message : "Couldn't generate a schedule");
    } finally {
      setGenerating(false);
    }
  }

  // Another version of the current run, with (possibly changed) adjustments.
  async function regenerate(adjustments: Adjustment[], busy: SummaryBusy) {
    if (!currentRun) return;
    setSummaryBusy(busy);
    setSummaryError(null);
    try {
      const next = await requestGeneration({
        mode: currentRun.mode,
        rules: { overtimePolicy: currentRun.rules.overtimePolicy, pendingTimeOff: currentRun.rules.pendingTimeOff },
        adjustments,
        replaceRunId: currentRun.runId,
      });
      setRun(next);
      setDrafts(await fetchDrafts(weekStart));
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : "Couldn't generate a schedule");
    } finally {
      setSummaryBusy(null);
    }
  }

  function handleSuggestion(s: Suggestion) {
    if (!currentRun) return;
    regenerate(
      [
        ...currentRun.adjustments.filter((a) => !(a.kind === "employee_hours" && a.employeeId === s.employeeId)),
        { kind: "employee_hours", employeeId: s.employeeId, minHours: null, maxHours: s.maxHours },
      ],
      "suggestion"
    );
  }

  async function handleUndo() {
    if (!currentRun) return;
    setSummaryBusy("undo");
    setSummaryError(null);
    try {
      const res = await apiFetch("/api/drafts/generate/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: currentRun.runId }),
      });
      if (!res.ok) await throwApiError(res, "Couldn't undo");
      setDrafts(await fetchDrafts(weekStart));
      // An earlier run for the week may be the latest again.
      setRun(await fetchLatestRun(weekStart));
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : "Couldn't undo");
    } finally {
      setSummaryBusy(null);
    }
  }

  async function handleSetEmploymentType(employeeId: number, type: EmploymentType) {
    const res = await apiFetch("/api/employees", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: employeeId, employmentType: type }),
    });
    if (!res.ok) return;
    setEmployees((prev) => prev.map((e) => (e.id === employeeId ? { ...e, employment_type: type } : e)));
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
      setRun(null);
      setConfirmPublish(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to publish schedule");
      setConfirmPublish(false);
    } finally {
      setPublishing(false);
    }
  }

  const isLoading = loading || sharedLoading;
  const weekLabel = `${fmtShortDate(dates[0])} – ${fmtShortDate(dates[6])}, ${dates[6].slice(0, 4)}`;

  // ---- Non-manager gate ----
  if (!sharedLoading && !isManager) {
    return (
      <AppShell active="planner" isManager={isManager}>
        <main className="max-w-[480px] mx-auto tablet:max-w-none tablet:pb-10 pb-28 bg-bg min-h-screen flex flex-col items-center justify-center px-6 text-center desk:max-w-none">
          <div className="text-4xl mb-3" aria-hidden="true">🗓️</div>
          <h1 className="text-lg font-bold text-slate-100 mb-1.5">Draft Schedule</h1>
          <p className="text-sm text-slate-400">Only managers can create draft schedules.</p>
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
      className="flex-1 tablet:flex-none min-h-11 tablet:min-h-0 px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 border-none text-white font-bold text-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition-all shrink-0"
    >
      Publish ({drafts.length})
    </motion.button>
  );

  // The day picker sits below the charts until the desk layout; bring it into
  // view and focus the selected day.
  function focusDayPicker() {
    const picker = document.getElementById("planner-day-picker");
    picker?.scrollIntoView({ behavior: "smooth", block: "center" });
    picker?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
  }

  function openAutoSchedule() {
    setAutoError(null);
    setAutoOpen(true);
  }

  const sparkle = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9L12 3z" fill="currentColor" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" fill="currentColor" opacity="0.7" />
    </svg>
  );

  const autoButton = (
    <motion.button
      onClick={openAutoSchedule}
      disabled={isLoading}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      data-testid="auto-schedule-button"
      className="flex-1 tablet:flex-none min-h-11 tablet:min-h-0 px-3.5 py-2.5 rounded-xl bg-violet-500/15 border border-violet-500/35 text-violet-200 font-bold text-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-violet-500/25 transition-colors shrink-0 flex items-center justify-center gap-1.5"
    >
      {sparkle}
      Auto-schedule
    </motion.button>
  );

  const weekMinutesById = scheduledMinutesByEmployee(drafts, dates, timezone);
  function weekHoursText(emp: PlannerEmployee): { text: string; over: boolean } {
    const minutes = weekMinutesById.get(emp.id) ?? 0;
    const { maxMinutes } = limitsFromColumns(emp, settings.schedulingRules);
    const h = (m: number) => Math.round((m / 60) * 10) / 10;
    return { text: `${h(minutes)}/${h(maxMinutes)} h week`, over: minutes > maxMinutes };
  }

  return (
    <AppShell active="planner" isManager={isManager}>
      <main className="max-w-[480px] mx-auto tablet:max-w-none tablet:pb-10 pb-28 bg-bg min-h-screen desk:max-w-none desk:pb-8">
        {/* Header */}
        <div
          className="px-4 pb-3 flex flex-wrap items-center gap-x-3 gap-y-3 border-b border-slate-800 bg-bg
                     desk:px-6 desk:py-[14px] desk:pb-[14px]"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}
        >
          <button
            onClick={() => router.back()}
            className="size-11 rounded-xl bg-card border border-slate-800 text-slate-400 flex items-center justify-center cursor-pointer shrink-0 hover:bg-slate-800 hover:text-slate-200 transition-colors tablet:hidden"
            aria-label="Back"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xl font-extrabold text-slate-100 tracking-tight">Draft Schedule</span>
              <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-full px-2 py-0.5">
                Draft
              </span>
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <button
                onClick={() => setWeekOffset((w) => w - 1)}
                aria-label="Previous week"
                className="size-8 -my-1 rounded-md bg-transparent border-none text-slate-400 hover:text-slate-200 cursor-pointer flex items-center justify-center"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <span className="text-xs font-semibold text-slate-400 tabular-nums">{weekLabel}</span>
              <button
                onClick={() => setWeekOffset((w) => w + 1)}
                aria-label="Next week"
                className="size-8 -my-1 rounded-md bg-transparent border-none text-slate-400 hover:text-slate-200 cursor-pointer flex items-center justify-center"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              {weekOffset !== 1 && (
                <button
                  onClick={() => setWeekOffset(1)}
                  className="min-h-8 -my-1 px-1.5 text-[11px] font-semibold text-indigo-400 hover:text-indigo-300 bg-transparent border-none cursor-pointer"
                >
                  Next Week
                </button>
              )}
            </div>
          </div>
          {/* Phones: a row of their own under the title. */}
          <div className="w-full tablet:w-auto flex items-center gap-2">
            {autoButton}
            {publishButton}
          </div>
        </div>

        {/* Banners */}
        {migrationRequired && (
          <div role="alert" className="mx-4 mt-3 px-4 py-3 bg-amber-500/10 border border-amber-500/25 rounded-xl text-xs text-amber-400 tablet:mx-6">
            Database tables are missing. Run the migrations in <code className="font-mono">db/migrations/</code> (draft schedules + coverage profiles) in the Supabase SQL editor.
          </div>
        )}
        {error && !migrationRequired && (
          <div role="alert" className="mx-4 mt-3 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 text-center tablet:mx-6">
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
              className="mx-4 mt-3 px-4 py-3 bg-green-500/10 border border-green-500/25 rounded-xl text-sm text-green-400 text-center tablet:mx-6"
            >
              Published {publishResult.published} shift{publishResult.published === 1 ? "" : "s"}
              {publishResult.skipped > 0 && ` · ${publishResult.skipped} skipped (already scheduled)`}
            </motion.div>
          )}
        </AnimatePresence>

        {currentRun && currentRun.runId !== dismissedRunId && (
          <AutoScheduleSummary
            run={currentRun}
            employees={employees}
            busy={summaryBusy}
            error={summaryError}
            onUndo={handleUndo}
            onTryAnother={() => regenerate(currentRun.adjustments, "another")}
            onApplySuggestion={handleSuggestion}
            onDismiss={() => setDismissedRunId(currentRun.runId)}
          />
        )}

        {!isLoading && !migrationRequired && !publishResult && drafts.length === 0 && !currentRun && employees.length > 0 && (
          <div
            data-testid="auto-schedule-empty"
            className="mx-4 mt-3 tablet:mx-6 px-4 py-3.5 rounded-2xl border border-violet-500/25 bg-violet-500/[0.06] flex items-center gap-3"
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-100">No drafts for this week yet</div>
              <div className="text-xs text-slate-400 mt-0.5">
                Auto-schedule drafts the week from your coverage targets, availability, time off and hours. You review it before anything is published.
              </div>
            </div>
            {/* Phones have the header's button right above. */}
            <button
              onClick={openAutoSchedule}
              className="hidden tablet:flex px-3.5 py-2.5 rounded-xl bg-violet-500/20 border border-violet-500/35 text-violet-100 font-bold text-xs cursor-pointer hover:bg-violet-500/30 transition-colors shrink-0 items-center gap-1.5"
            >
              {sparkle}
              Auto-schedule
            </button>
          </div>
        )}

        <div className="px-4 pt-4 tablet:px-6 desk:grid desk:grid-cols-[1fr_400px] desk:gap-8 desk:items-start wide:grid-cols-[minmax(0,1fr)_440px] wide:max-w-[1680px] wide:mx-auto">
          {/* Left column — metrics & charts. Tablet and wide: the two charts sit side by side. */}
          <div className="tablet:grid tablet:grid-cols-2 tablet:gap-x-4 tablet:items-start desk:block wide:grid">
            <div className="grid grid-cols-4 gap-2 mb-4 tablet:col-span-2">
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

            <div className="min-w-0 tablet:row-start-2 tablet:col-start-1">
              <DraftCoverageChart
                drafts={drafts}
                dates={dates}
                storeHours={storeHours}
                curves={curves}
                selectedDate={selectedDate}
                onPickDay={focusDayPicker}
                timezone={timezone}
              />
            </div>

            {!isLoading && alertList.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-4 px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 tablet:col-span-2 tablet:row-start-3"
              >
                {(alertsExpanded ? alertList : alertList.slice(0, 1)).map((a) => (
                  <div key={a.key} className="flex items-center gap-2 text-xs text-amber-400 py-0.5">
                    <span aria-hidden="true">⚠</span> {a.text}
                  </div>
                ))}
                {alertList.length > 1 && (
                  <button
                    onClick={() => setAlertsExpanded((v) => !v)}
                    className="min-h-8 -mb-1.5 text-[11px] font-semibold text-amber-300/80 hover:text-amber-200 bg-transparent border-none cursor-pointer p-0"
                  >
                    {alertsExpanded ? "Show less" : `${alertList.length - 1} more alert${alertList.length - 1 === 1 ? "" : "s"} →`}
                  </button>
                )}
              </motion.div>
            )}

            <div className="min-w-0 tablet:row-start-2 tablet:col-start-2">
              <DraftBudgetChart
                drafts={drafts}
                dates={dates}
                curves={curves}
                isManager={isManager}
                timezone={timezone}
              />
            </div>

            {/* Full width on tablets and desks; side by side on wide screens. */}
            {!isLoading && (
              <>
                <div className="min-w-0 tablet:col-span-2 wide:col-span-1">
                  <WeekCoverageHeatmap
                    shifts={drafts}
                    dates={dates}
                    curves={curves}
                    selectedDate={selectedDate}
                    onSelectDate={(date) => setSelectedDayIdx(Math.max(0, dates.indexOf(date)))}
                  />
                </div>
                <div className="min-w-0 tablet:col-span-2 wide:col-span-1">
                  <DraftHoursPanel
                    employees={employees}
                    drafts={drafts}
                    dates={dates}
                    rules={settings.schedulingRules}
                    timezone={timezone}
                  />
                </div>
              </>
            )}
          </div>

          {/* Right column — week editor */}
          <div className="desk:sticky desk:top-4">
            <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase mb-2 px-1">
              Schedule At a Glance
            </div>

            {/* Day chips: the Planner's one day picker. The hourly coverage
                chart and the heatmap follow it. */}
            <div id="planner-day-picker" className="grid grid-cols-7 gap-1 mb-3 scroll-mt-4" role="group" aria-label="Day">
              {dates.map((date, i) => {
                const dayScheduled = scheduledHoursForDate(drafts, date, timezone);
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
                    <span className="text-[11px] font-semibold uppercase">{DAY_LABELS[dayOfWeek(date)]}</span>
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
              <span className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold shrink-0">Coverage</span>
              <select
                value={overrides[selectedDate] ?? ""}
                aria-label="Coverage profile for selected day"
                onChange={(e) => {
                  const v = e.target.value;
                  handleAssignProfile(selectedDate, v === "" ? null : Number(v))
                    .catch((err) => setError(err instanceof Error ? err.message : "Failed to update coverage"));
                }}
                className="flex-1 min-w-0 bg-bg border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-indigo-500/70 transition-colors cursor-pointer"
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
                <span className="text-[11px] font-bold uppercase text-violet-300 bg-violet-500/15 border border-violet-500/25 rounded-full px-2 py-0.5 shrink-0">
                  Override
                </span>
              )}
            </div>

            {/* Selected day summary */}
            <div className="flex gap-2 mb-3">
              {(() => {
                const sch = Math.round(scheduledHoursForDate(drafts, selectedDate, timezone) * 10) / 10;
                const bud = Math.round(curveHours(curves[selectedDate] ?? []) * 10) / 10;
                const dayVar = Math.round((sch - bud) * 10) / 10;
                return [
                  { label: "Scheduled", value: `${sch} hrs`, color: "#3b82f6" },
                  { label: "Budget", value: `${bud} hrs`, color: "#818cf8" },
                  { label: "Variance", value: `${dayVar > 0 ? "+" : ""}${dayVar} hrs`, color: dayVar > 0 ? "#f87171" : dayVar < 0 ? "#fbbf24" : "#22c55e" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex-1 bg-card rounded-xl px-2 py-2 text-center border border-white/[0.05]">
                    <div className="text-xs font-bold tabular-nums" style={{ color }}>{value}</div>
                    <div className="text-[11px] text-slate-500 uppercase tracking-wider mt-0.5">{label}</div>
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
                    const week = weekHoursText(emp);
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
                            <span className={week.over ? "text-red-400" : "text-slate-500"}> · {week.text}</span>
                          </div>
                        </div>
                        {d.generationRunId ? (
                          <span className="text-[11px] font-bold uppercase text-violet-300 bg-violet-500/15 border border-violet-500/25 rounded-full px-2 py-0.5 shrink-0">
                            Auto
                          </span>
                        ) : (
                          <span className="text-[11px] font-bold uppercase text-amber-400/90 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5 shrink-0">
                            Draft
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {selectedDayOff.map((emp) => {
                    const week = weekHoursText(emp);
                    return (
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
                          <div className="text-xs text-slate-600 tabular-nums">
                            Off<span className={week.over ? "text-red-400" : ""}> · {week.text}</span>
                          </div>
                        </div>
                        <span className="text-[11px] font-semibold text-indigo-400 shrink-0">+ Add</span>
                      </button>
                    );
                  })}
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

        <AutoScheduleSheet
          open={autoOpen}
          onClose={() => setAutoOpen(false)}
          weekLabel={weekLabel}
          dates={dates}
          employees={employees}
          draftCount={drafts.length}
          curves={curves}
          rules={settings.schedulingRules}
          initialAdjustments={currentRun?.adjustments ?? []}
          generating={generating}
          error={autoError}
          onGenerate={handleGenerate}
          onSetEmploymentType={handleSetEmploymentType}
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
