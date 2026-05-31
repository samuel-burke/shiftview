"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Schedule,
  StoreHours,
  TimeOffRequest,
  getShiftType,
  fmtMinutes,
  SHIFT_COLORS,
} from "../../data/types";
import WeekView from "../../components/WeekView";
import MonthView from "../../components/MonthView";
import BottomNav from "../../components/BottomNav";
import UserMenu from "../../components/UserMenu";
import NotificationBell from "../../components/NotificationBell";
import DatePickerSheet from "../../components/DatePickerSheet";
import AvailabilitySection from "../../components/AvailabilitySection";
import { createClient } from "@/lib/supabase-browser";

type View = "week" | "month";

export function isShiftUpcoming(
  shift: { date: string; endMinutes: number; startMinutes: number },
  todayKey: string,
  nowMinutes: number,
): boolean {
  return shift.date > todayKey || (shift.date === todayKey && shift.endMinutes > nowMinutes);
}

export function formatNextShiftDate(dateStr: string, todayKey: string): string {
  if (dateStr === todayKey) return "Today";
  const d = new Date(todayKey + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  const tomorrowKey = d.toISOString().slice(0, 10);
  if (dateStr === tomorrowKey) return "Tomorrow";
  return new Date(dateStr + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

export function getDaysUntil(dateStr: string, todayKey: string): number {
  const a = new Date(dateStr + "T12:00:00Z").getTime();
  const b = new Date(todayKey + "T12:00:00Z").getTime();
  return Math.round((a - b) / 86400000);
}

const DEFAULT_HOURS: Record<number, StoreHours> = {
  0: { open: 480, close: 1200 },
  1: { open: 360, close: 1320 },
  2: { open: 360, close: 1320 },
  3: { open: 360, close: 1320 },
  4: { open: 360, close: 1320 },
  5: { open: 360, close: 1320 },
  6: { open: 360, close: 1320 },
};

function toDateKey(d: Date, tz = "America/New_York") {
  return d.toLocaleDateString("en-CA", { timeZone: tz });
}

function offsetDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setDate(d.getDate() + n);
  return result;
}

function getWeekStart(d: Date, firstDay: number): Date {
  const result = new Date(d);
  result.setDate(d.getDate() - (d.getDay() - firstDay + 7) % 7);
  return result;
}

function formatWeekRange(start: Date, end: Date): string {
  const startStr = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endStr = end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return `${startStr} – ${endStr}`;
}

const SHIFT_TYPE_LABELS: Record<string, string> = {
  opener: "Early Shift",
  mid: "Mid Shift",
  closer: "Closing Shift",
};

export default function SchedulePageClient() {
  const [today] = useState(() => new Date());
  const router = useRouter();
  const searchParams = useSearchParams();
  const isDemo = searchParams.get("demo") === "true";
  const supabase = createClient();

  const [view, setView] = useState<View>("week");
  const [selectedDate, setSelectedDate] = useState(today);
  const [navDate, setNavDate] = useState(today);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [employeeName, setEmployeeName] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [isManager, setIsManager] = useState(false);
  const [weeklyHours, setWeeklyHours] = useState<Record<number, StoreHours>>(DEFAULT_HOURS);
  const [firstDayOfWeek, setFirstDayOfWeek] = useState(6);
  const [timezone, setTimezone] = useState("America/New_York");
  const [loading, setLoading] = useState(true);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [timeOffStatus, setTimeOffStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [timeOffError, setTimeOffError] = useState<string | null>(null);
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [nextShift, setNextShift] = useState<Schedule | null | undefined>(undefined);
  const supplementalFetchedRef = useRef(false);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  useEffect(() => {
    fetch(`/api/me${isDemo ? "?demo=true" : ""}`)
      .then((r) => r.json())
      .then(({ employeeName, isManager, employeeId }) => {
        setEmployeeName(employeeName ?? null);
        setIsManager(!!isManager);
        setEmployeeId(employeeId ?? null);
      })
      .catch(() => {});
    fetch("/api/store-hours")
      .then((r) => r.json())
      .then((data) => setWeeklyHours((prev) => ({ ...prev, ...data })))
      .catch(() => {});
    fetch("/api/settings")
      .then((r) => r.json())
      .then(({ firstDayOfWeek, timezone: tz }) => {
        if (firstDayOfWeek != null) setFirstDayOfWeek(firstDayOfWeek);
        if (tz) setTimezone(tz);
      })
      .catch(() => {});
    if (!isDemo) {
      fetch("/api/time-off")
        .then((r) => r.json())
        .then(({ requests }) => {
          if (Array.isArray(requests)) {
            setTimeOffRequests(requests.map((r: { id: number; date: string; status: string; note?: string }) => ({
              id: r.id,
              date: r.date,
              status: r.status as TimeOffRequest["status"],
              note: r.note,
            })));
          }
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    let from: Date, to: Date;
    if (view === "week") {
      const ws = getWeekStart(navDate, firstDayOfWeek);
      from = ws;
      to = offsetDays(ws, 6);
    } else {
      from = new Date(navDate.getFullYear(), navDate.getMonth(), 1);
      to = new Date(navDate.getFullYear(), navDate.getMonth() + 1, 0);
    }
    setLoading(true);
    setScheduleError(null);
    fetch(`/api/my-schedule?from=${toDateKey(from, timezone)}&to=${toDateKey(to, timezone)}${isDemo ? "&demo=true" : ""}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data) => {
        setSchedules(data.schedules ?? []);
        setLoading(false);
      })
      .catch(() => { setScheduleError("Failed to load schedule"); setLoading(false); });
  }, [view, navDate, firstDayOfWeek, timezone]);

  // Reset time-off request status when selected date changes
  useEffect(() => {
    setTimeOffStatus("idle");
    setTimeOffError(null);
  }, [selectedDate]);

  async function handleRequestDayOff() {
    if (!employeeId || isDemo) return;
    setTimeOffStatus("loading");
    setTimeOffError(null);
    try {
      const res = await fetch("/api/time-off", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, date: selectedDateKey }),
      });
      const json = await res.json();
      if (!res.ok) {
        setTimeOffError(json.error ?? "Failed to submit request");
        setTimeOffStatus("error");
      } else {
        setTimeOffStatus("success");
        setTimeOffRequests((prev) => [
          ...prev.filter((r) => r.date !== selectedDateKey),
          { id: json.id, date: selectedDateKey, status: "pending" },
        ]);
      }
    } catch {
      setTimeOffError("Failed to submit request");
      setTimeOffStatus("error");
    }
  }

  useEffect(() => {
    let cancelled = false;
    const todayKey = toDateKey(today);
    const nowMinutes = today.getHours() * 60 + today.getMinutes();
    const upcoming = schedules
      .filter(s => s.date > todayKey || (s.date === todayKey && s.endMinutes > nowMinutes))
      .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMinutes - b.startMinutes);
    if (upcoming.length > 0) {
      setNextShift(upcoming[0]);
    } else if (!loading) {
      if (supplementalFetchedRef.current) return;
      supplementalFetchedRef.current = true;
      // Do a supplemental fetch for next 30 days
      const to = new Date(today); to.setDate(today.getDate() + 30);
      const toKey = toDateKey(to);
      fetch(`/api/my-schedule?from=${todayKey}&to=${toKey}${isDemo ? "&demo=true" : ""}`)
        .then(r => r.json())
        .then(data => {
          if (cancelled) return;
          const upcoming = (data.schedules ?? [])
            .filter((s: Schedule) => s.date > todayKey || (s.date === todayKey && s.endMinutes > nowMinutes))
            .sort((a: Schedule, b: Schedule) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMinutes - b.startMinutes);
          setNextShift(upcoming[0] ?? null);
        })
        .catch(() => { if (!cancelled) setNextShift(null); });
    }
    return () => { cancelled = true; };
  }, [schedules, loading]);

  function goToPrev() {
    if (view === "week") {
      const newNav = offsetDays(navDate, -7);
      setNavDate(newNav);
      setSelectedDate((sd) => offsetDays(sd, -7));
    } else {
      const newNav = new Date(navDate.getFullYear(), navDate.getMonth() - 1, 1);
      const lastDay = new Date(newNav.getFullYear(), newNav.getMonth() + 1, 0).getDate();
      setNavDate(newNav);
      setSelectedDate((sd) =>
        new Date(newNav.getFullYear(), newNav.getMonth(), Math.min(sd.getDate(), lastDay)),
      );
    }
  }

  function goToNext() {
    if (view === "week") {
      const newNav = offsetDays(navDate, 7);
      setNavDate(newNav);
      setSelectedDate((sd) => offsetDays(sd, 7));
    } else {
      const newNav = new Date(navDate.getFullYear(), navDate.getMonth() + 1, 1);
      const lastDay = new Date(newNav.getFullYear(), newNav.getMonth() + 1, 0).getDate();
      setNavDate(newNav);
      setSelectedDate((sd) =>
        new Date(newNav.getFullYear(), newNav.getMonth(), Math.min(sd.getDate(), lastDay)),
      );
    }
  }

  function switchView(newView: View) {
    setView(newView);
    setNavDate(selectedDate);
  }

  function goToToday() {
    setNavDate(today);
    setSelectedDate(today);
  }

  function handlePickerSelect(d: Date) {
    setSelectedDate(d);
    setNavDate(d);
  }

  const weekStart = useMemo(() => getWeekStart(navDate, firstDayOfWeek), [navDate, firstDayOfWeek]);
  const weekEnd = useMemo(() => offsetDays(weekStart, 6), [weekStart]);

  const todayKey = toDateKey(today, timezone);
  const isAtToday =
    view === "week"
      ? todayKey >= toDateKey(weekStart, timezone) && todayKey <= toDateKey(weekEnd, timezone)
      : navDate.getFullYear() === today.getFullYear() && navDate.getMonth() === today.getMonth();

  const rangeLabel =
    view === "week"
      ? formatWeekRange(weekStart, weekEnd)
      : navDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const selectedDateKey = toDateKey(selectedDate, timezone);
  const selectedSchedule =
    schedules.find((s) => s.date.slice(0, 10) === selectedDateKey) ?? null;

  const selectedDayHours = weeklyHours[selectedDate.getDay()] ?? { open: 360, close: 1320 };
  const shiftType = selectedSchedule
    ? getShiftType(selectedSchedule.startMinutes, selectedSchedule.endMinutes, selectedDayHours.open, selectedDayHours.close)
    : null;
  const shiftColor = shiftType ? SHIFT_COLORS[shiftType] : null;
  const shiftLabel = shiftType ? SHIFT_TYPE_LABELS[shiftType] : null;
  const shiftHours = selectedSchedule
    ? (selectedSchedule.endMinutes - selectedSchedule.startMinutes) / 60
    : null;

  const isSelectedToday = selectedDateKey === toDateKey(today, timezone);
  const selectedDayLabel = isSelectedToday
    ? "Today"
    : selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

  const selectedTimeOff = timeOffRequests.find((r) => r.date === selectedDateKey) ?? null;

  // Show "Request Day Off" when: no shift, future date, has employeeId, no existing pending/approved request
  const canRequestDayOff =
    !selectedSchedule &&
    selectedDateKey > todayKey &&
    employeeId !== null &&
    !isDemo &&
    selectedTimeOff?.status !== "pending" &&
    selectedTimeOff?.status !== "approved";

  // Stats
  const totalShifts = schedules.length;
  const totalHours = schedules.reduce(
    (acc, s) => acc + (s.endMinutes - s.startMinutes) / 60,
    0,
  );
  const daysInRange =
    view === "week"
      ? 7
      : new Date(navDate.getFullYear(), navDate.getMonth() + 1, 0).getDate();
  const daysOff = Math.max(0, daysInRange - totalShifts);

  const totalHoursDisplay = Number.isInteger(totalHours)
    ? `${totalHours} hrs`
    : `${totalHours.toFixed(1)} hrs`;

  const todayStr = today.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const firstName = employeeName ? employeeName.split(" ")[0] : "Schedule";

  return (
    <main className="max-w-[480px] mx-auto pb-28 bg-bg min-h-screen">
      {/* Top bar */}
      <div
        className="sticky top-0 z-20 px-4 pb-3 flex items-center justify-between border-b border-slate-800 bg-bg"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}
      >
        <span className="text-2xl font-extrabold text-slate-100 tracking-tight">
          Shift
          <span className="bg-gradient-to-r from-blue-500 to-violet-500 bg-clip-text text-transparent">
            View
          </span>
        </span>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-400">{todayStr}</span>
          {!isDemo && <NotificationBell />}
          <UserMenu
            name={employeeName}
            isManager={isManager}
            onSignOut={isDemo ? undefined : handleSignOut}
            onSignIn={isDemo ? () => router.push("/login") : undefined}
          />
        </div>
      </div>

      <div className="px-4 pt-4">
        {/* Next Shift card */}
        <div className="bg-card border border-slate-800/60 rounded-2xl px-4 py-4 mb-4">
          <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mb-2">Next Shift</div>
          {nextShift === undefined ? (
            <div className="h-8 bg-slate-800 rounded animate-pulse" />
          ) : nextShift ? (
            <>
              <div className="text-slate-300 font-semibold text-sm">
                {formatNextShiftDate(nextShift.date, toDateKey(today))}
              </div>
              <div className="text-2xl font-extrabold text-slate-100 mt-1">
                {fmtMinutes(nextShift.startMinutes)} – {fmtMinutes(nextShift.endMinutes)}
              </div>
              {getDaysUntil(nextShift.date, toDateKey(today)) > 1 && (
                <div className="text-xs text-slate-400 mt-1">
                  in {getDaysUntil(nextShift.date, toDateKey(today))} days
                </div>
              )}
            </>
          ) : (
            <div className="text-slate-400 text-sm">No upcoming shifts scheduled</div>
          )}
        </div>

        {/* MY SCHEDULE label + Week/Month toggle */}
        <div className="flex items-start justify-between mb-1">
          <div>
            <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">
              My Schedule
            </div>
            <div className="text-[28px] font-extrabold text-slate-100 leading-tight mt-0.5">
              {firstName}
            </div>
          </div>
          {/* Toggle */}
          <div className="flex bg-card rounded-xl p-[3px] mt-1">
            <button
              onClick={() => switchView("week")}
              className={`px-4 py-1.5 rounded-[9px] text-sm font-semibold transition-colors cursor-pointer ${
                view === "week" ? "bg-slate-700 text-slate-100" : "text-slate-400"
              }`}
            >
              Week
            </button>
            <button
              onClick={() => switchView("month")}
              className={`px-4 py-1.5 rounded-[9px] text-sm font-semibold transition-colors cursor-pointer ${
                view === "month" ? "bg-slate-700 text-slate-100" : "text-slate-400"
              }`}
            >
              Month
            </button>
          </div>
        </div>

        {/* Range label + prev/next */}
        <div className="flex items-center justify-between mt-5 mb-4">
          <button
            onClick={() => setPickerOpen(true)}
            className="font-bold text-slate-100 text-base flex items-center gap-1.5 bg-transparent border-none p-0 cursor-pointer"
          >
            {rangeLabel}
            <span className="text-[12px] text-blue-500 font-normal">▾</span>
          </button>
          <div className="flex items-center gap-2">
            {!isAtToday && (
              <button
                onClick={goToToday}
                className="text-[12px] font-bold text-slate-100 bg-slate-700 border border-slate-600 rounded-[9px] px-3 py-1.5 cursor-pointer"
              >
                Today
              </button>
            )}
            <button
              onClick={goToPrev}
              aria-label="Previous"
              className="size-9 rounded-xl bg-card border border-slate-800 text-slate-400 flex items-center justify-center text-lg cursor-pointer"
            >
              ‹
            </button>
            <button
              onClick={goToNext}
              aria-label="Next"
              className="size-9 rounded-xl bg-card border border-slate-800 text-slate-400 flex items-center justify-center text-lg cursor-pointer"
            >
              ›
            </button>
          </div>
        </div>

        {/* Calendar */}
        {loading ? (
          <div className="h-[120px] flex items-center justify-center">
            <div className="spinner" />
          </div>
        ) : scheduleError ? (
          <div className="h-[120px] flex items-center justify-center">
            <div className="text-sm text-red-400 text-center">{scheduleError}</div>
          </div>
        ) : view === "week" ? (
          <WeekView
            schedules={schedules}
            weeklyHours={weeklyHours}
            firstDayOfWeek={firstDayOfWeek}
            selectedDate={selectedDate}
            weekStart={weekStart}
            onSelectDate={setSelectedDate}
            today={today}
            timeOffRequests={timeOffRequests}
          />
        ) : (
          <MonthView
            schedules={schedules}
            weeklyHours={weeklyHours}
            firstDayOfWeek={firstDayOfWeek}
            selectedDate={selectedDate}
            navDate={navDate}
            onSelectDate={setSelectedDate}
            today={today}
            timeOffRequests={timeOffRequests}
          />
        )}

        {/* Detail card */}
        <div className="bg-card rounded-2xl px-4 py-4 mb-3 mt-1 border border-slate-800/60">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-slate-400">{selectedDayLabel}</span>
            {shiftLabel && shiftColor && (
              <span
                className="text-xs font-semibold px-3 py-1 rounded-full"
                style={{ background: `${shiftColor}22`, color: shiftColor }}
              >
                {shiftLabel}
              </span>
            )}
          </div>
          {selectedSchedule ? (
            <>
              <div className="text-2xl font-bold text-slate-100 mt-1">
                {fmtMinutes(selectedSchedule.startMinutes)} – {fmtMinutes(selectedSchedule.endMinutes)}
              </div>
              <div className="text-sm text-slate-400 mt-0.5">
                {shiftHours} {shiftHours === 1 ? "hr" : "hrs"}
              </div>
            </>
          ) : (
            <div className="text-2xl font-bold text-slate-400 mt-1">Day Off</div>
          )}

          {/* Time-off request status or action */}
          {selectedTimeOff?.status === "pending" && !selectedSchedule && (
            <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30">
              <span className="text-amber-400 text-base">⏳</span>
              <span className="text-sm text-amber-300 font-semibold">Time-off request pending</span>
            </div>
          )}
          {selectedTimeOff?.status === "approved" && !selectedSchedule && (
            <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
              <span className="text-emerald-400 text-base">✓</span>
              <span className="text-sm text-emerald-300 font-semibold">Time off approved</span>
            </div>
          )}
          {selectedTimeOff?.status === "denied" && !selectedSchedule && selectedDateKey > todayKey && (
            <div className="mt-3">
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 mb-2">
                <span className="text-red-400 text-base">✕</span>
                <span className="text-sm text-red-300 font-semibold">Time-off request denied</span>
              </div>
              {employeeId !== null && !isDemo && (
                <button
                  onClick={handleRequestDayOff}
                  disabled={timeOffStatus === "loading"}
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 text-white font-bold text-sm cursor-pointer disabled:opacity-50"
                >
                  {timeOffStatus === "loading" ? "Submitting…" : "Request Again"}
                </button>
              )}
            </div>
          )}
          {canRequestDayOff && (
            <div className="mt-3">
              {timeOffStatus === "success" ? (
                <div className="text-sm text-emerald-400 font-semibold">Request submitted ✓</div>
              ) : (
                <>
                  <button
                    onClick={handleRequestDayOff}
                    disabled={timeOffStatus === "loading"}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 text-white font-bold text-sm cursor-pointer disabled:opacity-50"
                  >
                    {timeOffStatus === "loading" ? "Submitting…" : "Request Day Off"}
                  </button>
                  {timeOffStatus === "error" && timeOffError && (
                    <div className="text-xs text-red-400 mt-1.5">{timeOffError}</div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Stats row */}
        <div className="flex gap-2">
          <div className="flex-1 bg-card border border-slate-800/60 rounded-2xl px-3 py-4">
            <div className="text-3xl font-extrabold text-indigo-400">{totalShifts}</div>
            <div className="text-xs text-slate-400 mt-1">
              {view === "week" ? "Shifts this week" : "Shifts this month"}
            </div>
          </div>
          <div className="flex-1 bg-card border border-slate-800/60 rounded-2xl px-3 py-4">
            <div className="text-3xl font-extrabold text-indigo-400">{totalHoursDisplay}</div>
            <div className="text-xs text-slate-400 mt-1">
              {view === "week" ? "Hours" : "Est. hours"}
            </div>
          </div>
          <div className="flex-1 bg-card border border-slate-800/60 rounded-2xl px-3 py-4">
            <div className="text-3xl font-extrabold text-indigo-400">{daysOff}</div>
            <div className="text-xs text-slate-400 mt-1">Days off</div>
          </div>
        </div>
      </div>

      {/* Availability Section */}
      {(employeeId !== null || isDemo) && !loading && (
        <div className="px-4 mt-2">
          <AvailabilitySection
            employeeId={employeeId ?? 0}
            weeklyHours={weeklyHours}
            firstDayOfWeek={firstDayOfWeek}
            isDemo={isDemo}
          />
        </div>
      )}

      <DatePickerSheet
        open={pickerOpen}
        selected={selectedDate}
        today={today}
        firstDayOfWeek={firstDayOfWeek}
        onSelect={handlePickerSelect}
        onClose={() => setPickerOpen(false)}
      />

      <BottomNav active="schedule" />
    </main>
  );
}
