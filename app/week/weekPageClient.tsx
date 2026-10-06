"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AppShell from "../../components/AppShell";
import BottomNav from "../../components/BottomNav";
import EmployeeDrawer from "../../components/EmployeeDrawer";
import WeekGrid, { type PendingTimeOff } from "../../components/WeekGrid";
import { useAppData } from "@/lib/AppDataContext";
import { createApiFetch } from "@/lib/api-fetch";
import { useStoreTodayKey } from "@/hooks/useStoreTodayKey";
import { addDaysToKey, dayOfWeekForKey, formatDateKey, nowMinutesInTz, weekStartForKey } from "@/lib/dates";
import type { Employee, Schedule } from "@/data/types";

type Selected = { emp: Employee; date: string; sch: Schedule | null };

/** True when a key press is meant for a form control rather than the page. */
function typingInField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export default function WeekPageClient() {
  const router = useRouter();
  const { me, sharedLoading, storeHours, settings } = useAppData();
  const { timezone, firstDayOfWeek } = settings;
  const todayKey = useStoreTodayKey(timezone);
  const apiFetch = useMemo(() => createApiFetch(() => router.push("/login")), [router]);

  const thisWeek = weekStartForKey(todayKey, firstDayOfWeek);
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const start = weekStart ?? thisWeek;
  const dates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysToKey(start, i)), [start]);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [timeOff, setTimeOff] = useState<PendingTimeOff[]>([]);
  // The week whose shifts are on screen; while it differs from `start` the grid is loading.
  const [loadedWeek, setLoadedWeek] = useState<string | null>(null);
  const loading = loadedWeek !== start;
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Selected | null>(null);

  // Managers only — everyone else goes back to the dashboard.
  useEffect(() => {
    if (!sharedLoading && !me.isManager) router.replace("/");
  }, [sharedLoading, me.isManager, router]);

  useEffect(() => {
    apiFetch("/api/employees")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => { if (Array.isArray(data)) setEmployees(data); })
      .catch(() => setError("Couldn't load the team. Refresh to try again."));
    apiFetch("/api/time-off")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (data && Array.isArray(data.requests)) setTimeOff(data.requests); })
      .catch(() => {});
  }, [apiFetch]);

  const loadWeek = useCallback(async (keys: string[]) => {
    const days = await Promise.all(
      keys.map((d) => apiFetch(`/api/schedules?date=${d}`).then((r) => (r.ok ? r.json() : Promise.reject())))
    );
    // One entry per shift, limited to this week's days.
    const inWeek = new Set(keys);
    const byId = new Map<number, Schedule>();
    for (const s of days.flatMap((d) => (Array.isArray(d) ? (d as Schedule[]) : []))) {
      if (inWeek.has(s.date.slice(0, 10))) byId.set(s.id, s);
    }
    return [...byId.values()];
  }, [apiFetch]);

  useEffect(() => {
    let cancelled = false;
    loadWeek(dates)
      .then((all) => { if (!cancelled) { setSchedules(all); setError(null); } })
      .catch(() => { if (!cancelled) setError("Couldn't load this week's shifts. Refresh to try again."); })
      .finally(() => { if (!cancelled) setLoadedWeek(dates[0]); });
    return () => { cancelled = true; };
  }, [dates, loadWeek]);

  const reload = useCallback(async () => {
    const all = await loadWeek(dates);
    setSchedules(all);
    // Keep the open pane pointing at the fresh copy of its shift.
    setSelected((cur) => cur && { ...cur, sch: all.find((s) => s.employeeId === cur.emp.id && s.date.slice(0, 10) === cur.date) ?? null });
  }, [dates, loadWeek]);

  // ←/→ change the week, T jumps to this week. Ignored while typing or while
  // the shift pane is open (its own controls take the keys).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (selected || e.metaKey || e.ctrlKey || e.altKey || typingInField(e.target)) return;
      if (e.key === "ArrowLeft") setWeekStart(addDaysToKey(start, -7));
      else if (e.key === "ArrowRight") setWeekStart(addDaysToKey(start, 7));
      else if (e.key === "t" || e.key === "T") setWeekStart(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [start, selected]);

  async function mutate(init: RequestInit, fallback: string) {
    const res = await apiFetch("/api/schedules", { ...init, headers: { "Content-Type": "application/json" } });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (body.conflict) {
        throw Object.assign(new Error(body.message ?? "Conflict"), { conflict: body.conflict, window: body.window ?? null });
      }
      throw new Error(body.error ?? fallback);
    }
    await reload();
  }

  const weekLabel = `${formatDateKey(dates[0], { month: "short", day: "numeric" })} – ${formatDateKey(dates[6], { month: "short", day: "numeric", year: "numeric" })}`;
  const isThisWeek = start === thisWeek;
  const selDow = selected ? dayOfWeekForKey(selected.date) : 0;

  const navButton = "size-10 rounded-xl bg-card border border-slate-800 text-slate-400 flex items-center justify-center cursor-pointer hover:bg-slate-800 hover:text-slate-200 transition-colors";

  return (
    <AppShell active="week" isManager>
      <main
        className={`max-w-[480px] mx-auto pb-28 bg-bg min-h-screen tablet:max-w-none tablet:pb-10 wide:transition-[padding] wide:duration-300 ${
          selected ? "wide:pr-[420px]" : ""
        }`}
      >
        {/* Header */}
        <div
          className="px-4 pb-3 flex flex-wrap items-center gap-3 border-b border-slate-800 bg-bg tablet:px-6 desk:py-[14px]"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}
        >
          <button onClick={() => router.back()} aria-label="Back" className={`${navButton} size-11 tablet:hidden`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">Week</div>
            <h1 className="text-xl font-extrabold text-slate-100 tracking-tight tabular-nums">{weekLabel}</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setWeekStart(addDaysToKey(start, -7))} aria-label="Previous week" className={navButton}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <button
              onClick={() => setWeekStart(null)}
              disabled={isThisWeek}
              className="h-10 px-3.5 rounded-xl bg-card border border-slate-800 text-sm font-semibold text-slate-200 cursor-pointer hover:bg-slate-800 transition-colors disabled:opacity-40 disabled:cursor-default"
            >
              This week
            </button>
            <button onClick={() => setWeekStart(addDaysToKey(start, 7))} aria-label="Next week" className={navButton}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <Link
              href="/draft"
              className="h-10 px-4 rounded-xl text-sm font-bold text-white bg-gradient-to-r from-blue-500 to-violet-500 flex items-center hover:brightness-110 transition-all"
            >
              Plan next week
            </Link>
          </div>
        </div>

        {error && (
          <div role="alert" className="mx-4 tablet:mx-6 mt-3 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
            {error}
          </div>
        )}

        <div className={`px-4 pt-4 tablet:px-6 wide:max-w-[1680px] wide:mx-auto transition-opacity ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
          <WeekGrid
            employees={employees}
            schedules={schedules}
            dates={dates}
            weeklyHours={storeHours}
            todayKey={todayKey}
            timeOff={timeOff}
            selected={selected ? { employeeId: selected.emp.id, date: selected.date } : null}
            onSelect={(emp, date, sch) => setSelected({ emp, date, sch })}
          />
          <p className="hidden desk:block mt-3 text-xs text-slate-500">
            Click a cell to edit or add a shift. <kbd className="font-mono">←</kbd> <kbd className="font-mono">→</kbd> change the week, <kbd className="font-mono">T</kbd> returns to this week.
          </p>
        </div>

        <EmployeeDrawer
          open={!!selected}
          employee={selected?.emp ?? null}
          schedule={selected?.sch ?? null}
          storeHours={storeHours[selDow]}
          nowMinutes={nowMinutesInTz(timezone)}
          isToday={selected?.date === todayKey}
          date={selected?.date}
          isManager
          onClose={() => setSelected(null)}
          onSave={(id, startMinutes, endMinutes, override = false) =>
            mutate({ method: "PUT", body: JSON.stringify({ id, startMinutes, endMinutes, override }) }, "Failed to save shift")}
          onCreate={(employeeId, startMinutes, endMinutes, override = false) =>
            mutate({ method: "POST", body: JSON.stringify({ employeeId, date: selected!.date, startMinutes, endMinutes, override }) }, "Failed to add shift")}
          onMarkOff={(id) => mutate({ method: "DELETE", body: JSON.stringify({ id }) }, "Failed to mark as off")}
        />

        <BottomNav active="week" />
      </main>
    </AppShell>
  );
}
