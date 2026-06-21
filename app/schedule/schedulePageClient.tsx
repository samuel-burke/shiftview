"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { motion, LayoutGroup } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  Schedule,
  TimeOffRequest,
  Callout,
  Employee,
  getShiftType,
  fmtMinutes,
  SHIFT_COLORS,
} from "../../data/types";
import { useAppData } from "@/lib/AppDataContext";
import WeekView from "../../components/WeekView";
import MonthView from "../../components/MonthView";
import BottomNav from "../../components/BottomNav";
import AppShell from "../../components/AppShell";
import UserMenu from "../../components/UserMenu";
import NotificationBell from "../../components/NotificationBell";
import DatePickerSheet from "../../components/DatePickerSheet";
import { createClient } from "@/lib/supabase-browser";
import {
  SkeletonNextShift,
  SkeletonWeekCalendar,
  SkeletonDetailCard,
  SkeletonStatsRow,
} from "../../components/Skeleton";
import {
  TimeOffPendingIcon,
  TimeOffApprovedIcon,
  TimeOffDeniedIcon,
  MegaphoneIcon,
} from "../../components/ShiftIcons";
import PendingTimeOffSection from "../../components/PendingTimeOffSection";
import SwapRequestsDrawer from "../../components/SwapRequestsDrawer";
import SwapRequestSheet, { type CoworkerShift } from "../../components/SwapRequestSheet";

type ManagerTimeOffRequest = {
  id: number;
  employeeName: string;
  date: string;
  note?: string;
  status: string;
};

// Shape the SwapRequestsDrawer consumes (flat, display-ready).
type PendingSwap = {
  id: number;
  requesterName: string;
  targetName: string;
  date: string;
  scheduleATime: string;
  scheduleBTime: string;
};

// GET /api/swaps returns nested employee/schedule joins; Supabase types them as
// object-or-array depending on the relationship, so normalize defensively.
function firstOf<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

type RawSwap = {
  id: number;
  schedule_a_id?: number;
  schedule_b_id?: number;
  requester?: { name: string } | { name: string }[] | null;
  target?: { name: string } | { name: string }[] | null;
  schedule_a?: { date: string; start_minutes: number; end_minutes: number } | { date: string; start_minutes: number; end_minutes: number }[] | null;
  schedule_b?: { date: string; start_minutes: number; end_minutes: number } | { date: string; start_minutes: number; end_minutes: number }[] | null;
};

function mapSwap(raw: RawSwap): PendingSwap {
  const requester = firstOf(raw.requester);
  const target = firstOf(raw.target);
  const a = firstOf(raw.schedule_a);
  const b = firstOf(raw.schedule_b);
  return {
    id: raw.id,
    requesterName: requester?.name ?? "Unknown",
    targetName: target?.name ?? "Unknown",
    date: a?.date ?? "",
    scheduleATime: a ? `${fmtMinutes(a.start_minutes)} – ${fmtMinutes(a.end_minutes)}` : "",
    scheduleBTime: b ? `${fmtMinutes(b.start_minutes)} – ${fmtMinutes(b.end_minutes)}` : "",
  };
}

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
  const supabase = createClient();

  const [view, setView] = useState<View>("week");
  const [selectedDate, setSelectedDate] = useState(today);
  const [navDate, setNavDate] = useState(today);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);

  const { me, storeHours: weeklyHours, settings, myScheduleCache, setMyScheduleCache, sharedLoading, cacheEmployees } = useAppData();
  const { isManager, employeeId, employeeName, isDemo } = me;
  const { firstDayOfWeek, timezone } = settings;
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [timeOffStatus, setTimeOffStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [timeOffError, setTimeOffError] = useState<string | null>(null);
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [myCallouts, setMyCallouts] = useState<Callout[]>([]);
  const [calloutStatus, setCalloutStatus] = useState<"idle" | "loading">("idle");
  const [calloutError, setCalloutError] = useState<string | null>(null);
  const [nextShift, setNextShift] = useState<Schedule | null | undefined>(undefined);
  const [pendingManagerTimeOff, setPendingManagerTimeOff] = useState<ManagerTimeOffRequest[]>([]);
  const [pendingSwaps, setPendingSwaps] = useState<PendingSwap[]>([]);
  const [swapDrawerOpen, setSwapDrawerOpen] = useState(false);
  // Schedule ids the current user already has a pending swap on (as requester or
  // target) — used to show a status badge instead of the request button.
  const [mySwapShiftIds, setMySwapShiftIds] = useState<number[]>([]);
  // Employee-facing swap creation sheet.
  const [swapSheetOpen, setSwapSheetOpen] = useState(false);
  const [swapCoworkers, setSwapCoworkers] = useState<CoworkerShift[]>([]);
  const [swapLoading, setSwapLoading] = useState(false);
  const [swapLoadError, setSwapLoadError] = useState<string | null>(null);
  const [swapSubmitting, setSwapSubmitting] = useState(false);
  const [swapSubmitError, setSwapSubmitError] = useState<string | null>(null);
  const [swapRequestStatus, setSwapRequestStatus] = useState<"idle" | "success">("idle");

  // Mutable refs so realtime callbacks always see the latest navigation state
  const navDateRef = useRef(navDate);
  navDateRef.current = navDate;
  const viewRef = useRef(view);
  viewRef.current = view;
  const firstDayOfWeekRef = useRef(firstDayOfWeek);
  firstDayOfWeekRef.current = firstDayOfWeek;
  const timezoneRef = useRef(timezone);
  timezoneRef.current = timezone;
  const isManagerRef = useRef(isManager);
  isManagerRef.current = isManager;

  async function handleApproveManagerTimeOff(id: number) {
    const res = await fetch(`/api/time-off/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    if (!res.ok) {
      const { error } = await res.json();
      throw new Error(error ?? "Failed to approve request");
    }
    setPendingManagerTimeOff((prev) => prev.filter((r) => r.id !== id));
  }

  async function handleDenyManagerTimeOff(id: number) {
    const res = await fetch(`/api/time-off/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "denied" }),
    });
    if (!res.ok) {
      const { error } = await res.json();
      throw new Error(error ?? "Failed to deny request");
    }
    setPendingManagerTimeOff((prev) => prev.filter((r) => r.id !== id));
  }

  const loadPendingSwaps = useCallback(() => {
    fetch("/api/swaps")
      .then((r) => r.json())
      .then((data: RawSwap[]) => {
        if (!Array.isArray(data)) return;
        setPendingSwaps(data.map(mapSwap));
        setMySwapShiftIds(
          data.flatMap((s) => [s.schedule_a_id, s.schedule_b_id])
            .filter((id): id is number => typeof id === "number"),
        );
      })
      .catch(() => {});
  }, []);

  // SwapRequestsDrawer's cards call these directly without catching, so swallow
  // errors here and resync from the server rather than throwing.
  async function handleApproveSwap(id: number) {
    try {
      const res = await fetch(`/api/swaps/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      });
      if (!res.ok) throw new Error();
      setPendingSwaps((prev) => prev.filter((s) => s.id !== id));
    } catch {
      loadPendingSwaps();
    }
  }

  async function handleDenySwap(id: number) {
    try {
      const res = await fetch(`/api/swaps/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "denied" }),
      });
      if (!res.ok) throw new Error();
      setPendingSwaps((prev) => prev.filter((s) => s.id !== id));
    } catch {
      loadPendingSwaps();
    }
  }

  // Open the swap creation sheet for the selected shift: load the coworkers also
  // scheduled that day (the candidate "schedule B" partners) plus their names.
  async function openSwapSheet() {
    if (!selectedSchedule || employeeId === null) return;
    setSwapSheetOpen(true);
    setSwapLoading(true);
    setSwapLoadError(null);
    setSwapSubmitError(null);
    setSwapRequestStatus("idle");
    setSwapCoworkers([]);
    try {
      const [schedRes, empRes] = await Promise.all([
        fetch(`/api/schedules?date=${selectedDateKey}`),
        fetch("/api/employees"),
      ]);
      if (!schedRes.ok) throw new Error();
      const sched = await schedRes.json();
      const emps = empRes.ok ? await empRes.json() : [];
      const nameById = new Map<number, string>();
      if (Array.isArray(emps)) {
        cacheEmployees(emps);
        emps.forEach((e: Employee) => nameById.set(e.id, e.name));
      }
      const list: CoworkerShift[] = (Array.isArray(sched) ? sched : [])
        .filter((s: Schedule) => s.employeeId !== employeeId)
        .map((s: Schedule) => ({
          scheduleId: s.id,
          employeeName: nameById.get(s.employeeId) ?? "Coworker",
          startMinutes: s.startMinutes,
          endMinutes: s.endMinutes,
        }))
        .sort((a: CoworkerShift, b: CoworkerShift) => a.startMinutes - b.startMinutes);
      setSwapCoworkers(list);
    } catch {
      setSwapLoadError("Couldn't load coworker shifts. Please try again.");
    } finally {
      setSwapLoading(false);
    }
  }

  async function submitSwap(scheduleBId: number) {
    if (!selectedSchedule) return;
    setSwapSubmitting(true);
    setSwapSubmitError(null);
    try {
      const res = await fetch("/api/swaps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduleAId: selectedSchedule.id, scheduleBId }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Failed to request swap");
      setSwapSheetOpen(false);
      setSwapRequestStatus("success");
      loadPendingSwaps();
    } catch (e) {
      setSwapSubmitError(e instanceof Error ? e.message : "Failed to request swap");
    } finally {
      setSwapSubmitting(false);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  // Load pending time-off once manager status is known
  useEffect(() => {
    if (isManager) {
      fetch("/api/time-off")
        .then((r) => r.json())
        .then(({ requests }) => { if (Array.isArray(requests)) setPendingManagerTimeOff(requests); })
        .catch(() => {});
    }
  }, [isManager]);

  // Load swap requests on mount. GET /api/swaps is session-scoped: managers get
  // every pending swap in the org (for the approval drawer), while employees get
  // only their own (for the per-shift "pending" badge and to prevent duplicates).
  useEffect(() => {
    loadPendingSwaps();
  }, [loadPendingSwaps]);

  // Load user's own time-off requests on mount
  useEffect(() => {
    fetch("/api/time-off?mine=true")
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
  }, []);

  // Load user's own upcoming call-outs on mount
  useEffect(() => {
    fetch("/api/callouts?mine=true")
      .then((r) => r.json())
      .then(({ callouts }) => { if (Array.isArray(callouts)) setMyCallouts(callouts); })
      .catch(() => {});
  }, []);

  async function handleCallOut() {
    if (!employeeId) return;
    setCalloutStatus("loading");
    setCalloutError(null);
    try {
      const res = await fetch("/api/callouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, date: selectedDateKey }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to call out");
      setMyCallouts((prev) => [
        ...prev.filter((c) => c.date !== selectedDateKey),
        { id: json.id, employeeId, date: selectedDateKey },
      ]);
    } catch (e) {
      setCalloutError(e instanceof Error ? e.message : "Failed to call out");
    } finally {
      setCalloutStatus("idle");
    }
  }

  async function handleUndoCallOut(id: number) {
    setCalloutStatus("loading");
    setCalloutError(null);
    try {
      const res = await fetch(`/api/callouts/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to undo call-out");
      }
      setMyCallouts((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      setCalloutError(e instanceof Error ? e.message : "Failed to undo call-out");
    } finally {
      setCalloutStatus("idle");
    }
  }

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
    const fromKey = toDateKey(from, timezone);
    const toKey = toDateKey(to, timezone);
    const rangeKey = `${fromKey}:${toKey}`;
    setScheduleError(null);

    const cached = myScheduleCache[rangeKey];
    if (cached) {
      setSchedules(cached);
      setLoading(false);
    } else {
      setLoading(true);
    }

    fetch(`/api/my-schedule?from=${fromKey}&to=${toKey}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data) => {
        const scheds = data.schedules ?? [];
        setSchedules(scheds);
        setMyScheduleCache(rangeKey, scheds);
        setLoading(false);
      })
      .catch(() => { if (!cached) { setScheduleError("Failed to load schedule"); setLoading(false); } });
  }, [view, navDate, firstDayOfWeek, timezone]);

  // Reset time-off request status when selected date changes
  useEffect(() => {
    setTimeOffStatus("idle");
    setTimeOffError(null);
    setCalloutError(null);
    setSwapRequestStatus("idle");
  }, [selectedDate]);

  async function handleRequestDayOff() {
    if (!employeeId) return;
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

  // The next-shift card is always relative to *today* — not the week/month the
  // user is currently browsing. Deriving it from `schedules` (the viewed range)
  // meant it showed the wrong shift, or nothing, as soon as you navigated off
  // the current week. Fetch the upcoming window from today directly instead, so
  // navigation never affects it.
  useEffect(() => {
    let cancelled = false;
    const now = new Date();
    const todayKey = toDateKey(now, timezone);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const to = new Date(now);
    to.setDate(now.getDate() + 30);
    const toKey = toDateKey(to, timezone);
    fetch(`/api/my-schedule?from=${todayKey}&to=${toKey}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data) => {
        if (cancelled) return;
        const upcoming = (data.schedules ?? [])
          .filter((s: Schedule) => s.date > todayKey || (s.date === todayKey && s.endMinutes > nowMinutes))
          .sort((a: Schedule, b: Schedule) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMinutes - b.startMinutes));
        setNextShift(upcoming[0] ?? null);
      })
      .catch(() => { if (!cancelled) setNextShift(null); });
    return () => { cancelled = true; };
  }, [employeeId, timezone]);

  // Supabase Realtime — live updates for schedule, time-off, store hours, settings
  useEffect(() => {
    function refetchSchedule() {
      const nd = navDateRef.current;
      const v = viewRef.current;
      const fdw = firstDayOfWeekRef.current;
      const tz = timezoneRef.current;
      let from: Date, to: Date;
      if (v === "week") {
        const ws = getWeekStart(nd, fdw);
        from = ws;
        to = offsetDays(ws, 6);
      } else {
        from = new Date(nd.getFullYear(), nd.getMonth(), 1);
        to = new Date(nd.getFullYear(), nd.getMonth() + 1, 0);
      }
      const fk = toDateKey(from, tz);
      const tk = toDateKey(to, tz);
      fetch(`/api/my-schedule?from=${fk}&to=${tk}`)
        .then((r) => r.ok ? r.json() : Promise.reject())
        .then((data) => {
          const scheds = data.schedules ?? [];
          setSchedules(scheds);
          setMyScheduleCache(`${fk}:${tk}`, scheds);
        })
        .catch(() => {});
    }

    function refetchTimeOff() {
      fetch("/api/time-off?mine=true")
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
      if (isManagerRef.current) {
        fetch("/api/time-off")
          .then((r) => r.json())
          .then(({ requests }) => { if (Array.isArray(requests)) setPendingManagerTimeOff(requests); })
          .catch(() => {});
      }
    }

    function refetchSwaps() {
      loadPendingSwaps();
    }

    let hiddenAt = 0;
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (Date.now() - hiddenAt > 5_000) {
        refetchSchedule();
        refetchTimeOff();
        refetchSwaps();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);

    function refetchCallouts() {
      fetch("/api/callouts?mine=true")
        .then((r) => r.json())
        .then(({ callouts }) => { if (Array.isArray(callouts)) setMyCallouts(callouts); })
        .catch(() => {});
    }

    const channel = supabase
      .channel("schedule-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "schedules" }, refetchSchedule)
      .on("postgres_changes", { event: "*", schema: "public", table: "time_off_requests" }, refetchTimeOff)
      .on("postgres_changes", { event: "*", schema: "public", table: "callouts" }, refetchCallouts)
      .on("postgres_changes", { event: "*", schema: "public", table: "shift_swaps" }, refetchSwaps)
      .subscribe();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      supabase.removeChannel(channel);
    };
  }, [loadPendingSwaps]);

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

  const calloutDates = useMemo(() => myCallouts.map((c) => c.date), [myCallouts]);
  const selectedCallout = myCallouts.find((c) => c.date === selectedDateKey) ?? null;

  // Show "Call Out" when: the selected day is today or later, the user has an
  // employee record, and they haven't already called out for it. (You can call
  // out whether or not a shift is posted yet.)
  const canCallOut =
    !selectedCallout &&
    selectedDateKey >= todayKey &&
    employeeId !== null;

  // Show "Request Day Off" when: no shift, future date, has employeeId, no existing pending/approved request
  const canRequestDayOff =
    !selectedSchedule &&
    selectedDateKey > todayKey &&
    employeeId !== null &&
    selectedTimeOff?.status !== "pending" &&
    selectedTimeOff?.status !== "approved";

  // This shift is already tied to a pending swap (either side) — show a badge
  // rather than letting the user stack a second request on it.
  const selectedShiftHasPendingSwap =
    selectedSchedule !== null && mySwapShiftIds.includes(selectedSchedule.id);

  // Offer "Request Shift Swap" when the user owns a shift on a today-or-future
  // day and it isn't already mid-swap. (Approval is the manager's job via the
  // SwapRequestsDrawer; this just creates the pending request.)
  const canRequestSwap =
    selectedSchedule !== null &&
    selectedDateKey >= todayKey &&
    employeeId !== null &&
    !selectedShiftHasPendingSwap;

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

  const totalHoursDisplay = Math.round(totalHours);

  const todayStr = today.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const firstName = !sharedLoading && employeeName ? employeeName.split(" ")[0] : sharedLoading ? "" : "Schedule";

  const calendarSection = (
    <>
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
        <LayoutGroup id="view-toggle">
          <div className="flex bg-card rounded-xl p-[3px] mt-1 relative">
            {(["week", "month"] as const).map((v) => (
              <button
                key={v}
                onClick={() => switchView(v)}
                aria-pressed={view === v}
                className={`relative px-4 py-3 rounded-[9px] text-sm font-semibold cursor-pointer z-10 transition-colors ${view === v ? "text-slate-50" : "text-slate-500"}`}
              >
                {view === v && (
                  <motion.div
                    layoutId="view-pill"
                    className="absolute inset-0 rounded-[9px] bg-slate-700"
                    style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.06)" }}
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <span className="relative z-10 capitalize">{v}</span>
              </button>
            ))}
          </div>
        </LayoutGroup>
      </div>

      {/* Range label + prev/next */}
      <div className="flex items-center justify-between mt-5 mb-4">
        <motion.button
          onClick={() => setPickerOpen(true)}
          aria-label={`${rangeLabel}. Open date picker`}
          aria-expanded={pickerOpen}
          aria-haspopup="dialog"
          whileHover={{ scale: 1.04, boxShadow: "0 0 16px rgba(99,102,241,0.25)" }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
          className="flex items-center gap-1.5 bg-slate-800/70 border border-slate-700/60 rounded-xl px-4 py-2.5 cursor-pointer"
        >
          <span className="text-base font-bold text-slate-100 tracking-tight">{rangeLabel}</span>
          <motion.span
            animate={{ rotate: pickerOpen ? 180 : 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 22 }}
            className="inline-block"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-blue-500"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </motion.span>
        </motion.button>
        <div className="flex items-center gap-2">
          {!isAtToday && (
            <motion.button
              onClick={goToToday}
              whileTap={{ scale: 0.93 }}
              whileHover={{ scale: 1.04 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              className="text-[12px] font-bold text-slate-100 bg-slate-700 border border-slate-600 rounded-[9px] px-3 py-3 cursor-pointer hover:bg-slate-600 transition-colors"
            >
              Today
            </motion.button>
          )}
          <motion.button
            onClick={goToPrev}
            aria-label={`Previous ${view === "week" ? "week" : "month"}`}
            whileTap={{ scale: 0.88 }}
            whileHover={{ scale: 1.08, boxShadow: "0 0 12px rgba(99,102,241,0.25)" }}
            transition={{ type: "spring", stiffness: 450, damping: 25 }}
            className="size-11 rounded-xl bg-card border border-slate-800 text-slate-400 flex items-center justify-center cursor-pointer hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </motion.button>
          <motion.button
            onClick={goToNext}
            aria-label={`Next ${view === "week" ? "week" : "month"}`}
            whileTap={{ scale: 0.88 }}
            whileHover={{ scale: 1.08, boxShadow: "0 0 12px rgba(99,102,241,0.25)" }}
            transition={{ type: "spring", stiffness: 450, damping: 25 }}
            className="size-11 rounded-xl bg-card border border-slate-800 text-slate-400 flex items-center justify-center cursor-pointer hover:bg-slate-800 hover:text-slate-200 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </motion.button>
        </div>
      </div>

      {/* Calendar */}
      {loading ? (
        <SkeletonWeekCalendar />
      ) : scheduleError ? (
        <div className="h-[120px] flex items-center justify-center">
          <div role="alert" className="text-sm text-red-400 text-center">{scheduleError}</div>
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
          calloutDates={calloutDates}
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
          calloutDates={calloutDates}
        />
      )}
    </>
  );

  const nextShiftCard = (
    <div className="bg-card border border-slate-800/60 rounded-2xl px-4 py-4 mb-4">
      <div className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider mb-2">Next Shift</div>
      {nextShift === undefined ? (
        <SkeletonNextShift />
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
  );

  const detailSection = (
    <>
      {/* Detail card */}
      {loading ? <SkeletonDetailCard /> : null}
      <div className={`bg-card rounded-2xl px-4 py-4 mb-3 mt-1 border border-slate-800/60${loading ? " hidden" : ""}`}>
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
              {shiftHours === 1 ? `${shiftHours} hr` : `${shiftHours} hrs`}
            </div>
          </>
        ) : (
          <div className="text-2xl font-bold text-slate-400 mt-1">Day Off</div>
        )}

        {/* Time-off request status or action */}
        {selectedTimeOff?.status === "pending" && !selectedSchedule && (
          <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-yellow-500/10 border border-yellow-500/30">
            <TimeOffPendingIcon size={16} color="rgb(250 204 21)" />
            <span className="text-sm text-yellow-300 font-semibold">Time-off request pending</span>
          </div>
        )}
        {selectedTimeOff?.status === "approved" && !selectedSchedule && (
          <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
            <TimeOffApprovedIcon size={16} color="rgb(52 211 153)" />
            <span className="text-sm text-emerald-300 font-semibold">Time off approved</span>
          </div>
        )}
        {selectedTimeOff?.status === "denied" && !selectedSchedule && selectedDateKey > todayKey && (
          <div className="mt-3">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 mb-2">
              <TimeOffDeniedIcon size={16} color="rgb(248 113 113)" />
              <span className="text-sm text-red-300 font-semibold">Time-off request denied</span>
            </div>
            {employeeId !== null && (
              <button
                onClick={handleRequestDayOff}
                disabled={timeOffStatus === "loading"}
                aria-busy={timeOffStatus === "loading"}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 text-white font-bold text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
              >
                {timeOffStatus === "loading" ? "Submitting…" : "Request Again"}
              </button>
            )}
          </div>
        )}
        {canRequestDayOff && (
          <div className="mt-3">
            {timeOffStatus === "success" ? (
              <div role="status" aria-live="polite" className="text-sm text-emerald-400 font-semibold">Request submitted ✓</div>
            ) : (
              <>
                <button
                  onClick={handleRequestDayOff}
                  disabled={timeOffStatus === "loading"}
                  aria-busy={timeOffStatus === "loading"}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 text-white font-bold text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                >
                  {timeOffStatus === "loading" ? "Submitting…" : "Request Day Off"}
                </button>
                {timeOffStatus === "error" && timeOffError && (
                  <div role="alert" className="text-xs text-red-400 mt-1.5">{timeOffError}</div>
                )}
              </>
            )}
          </div>
        )}

        {/* Call-out status / action */}
        {selectedCallout ? (
          <div className="mt-3">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 mb-2">
              <MegaphoneIcon size={16} color="rgb(248 113 113)" />
              <span className="text-sm text-red-300 font-semibold">Called out{isSelectedToday ? " today" : ""}</span>
            </div>
            <button
              onClick={() => handleUndoCallOut(selectedCallout.id)}
              disabled={calloutStatus === "loading"}
              aria-busy={calloutStatus === "loading"}
              className="w-full py-2.5 rounded-xl bg-slate-800 text-slate-300 border border-slate-700 font-semibold text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-700 transition-colors"
            >
              {calloutStatus === "loading" ? "…" : "Undo call-out"}
            </button>
            {calloutError && <div role="alert" className="text-xs text-red-400 mt-1.5">{calloutError}</div>}
          </div>
        ) : canCallOut ? (
          <div className="mt-3">
            <button
              onClick={handleCallOut}
              disabled={calloutStatus === "loading"}
              aria-busy={calloutStatus === "loading"}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-transparent border border-red-500/30 text-red-300 font-semibold text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:bg-red-500/10 transition-colors"
            >
              <MegaphoneIcon size={15} color="rgb(248 113 113)" />
              {calloutStatus === "loading" ? "Submitting…" : selectedSchedule ? "Can't make this shift? Call out" : "Call out"}
            </button>
            {calloutError && <div role="alert" className="text-xs text-red-400 mt-1.5">{calloutError}</div>}
          </div>
        ) : null}

        {/* Shift swap status / action */}
        {selectedShiftHasPendingSwap ? (
          <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-yellow-500/10 border border-yellow-500/30">
            <TimeOffPendingIcon size={16} color="rgb(250 204 21)" />
            <span className="text-sm text-yellow-300 font-semibold">Swap request pending</span>
          </div>
        ) : canRequestSwap ? (
          <div className="mt-3">
            {swapRequestStatus === "success" ? (
              <div role="status" aria-live="polite" className="text-sm text-emerald-400 font-semibold">Swap requested ✓</div>
            ) : (
              <button
                onClick={openSwapSheet}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-transparent border border-indigo-500/30 text-indigo-300 font-semibold text-sm cursor-pointer hover:bg-indigo-500/10 transition-colors"
              >
                <span aria-hidden="true">⇄</span>
                Request Shift Swap
              </button>
            )}
          </div>
        ) : null}
      </div>

      {/* Stats row */}
      {loading ? <SkeletonStatsRow /> : null}
      <div className={`flex gap-2${loading ? " hidden" : ""}`}>
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

      {isManager && (
        <motion.button
          onClick={() => router.push("/draft")}
          whileTap={{ scale: 0.98 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          className="w-full mt-4 py-3 text-sm font-bold text-white bg-gradient-to-r from-blue-500 to-violet-500 border-none rounded-xl cursor-pointer hover:brightness-110 transition-all"
        >
          Plan Draft Schedule
        </motion.button>
      )}

      {isManager && (
        <button
          onClick={() => setSwapDrawerOpen(true)}
          className="w-full mt-3 py-3 text-sm font-bold text-slate-200 bg-card border border-slate-800/60 rounded-xl cursor-pointer hover:border-indigo-500/50 transition-colors flex items-center justify-center gap-2"
        >
          Swap Requests
          {pendingSwaps.length > 0 && (
            <span className="bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-px text-[11px] text-amber-400">
              {pendingSwaps.length}
            </span>
          )}
        </button>
      )}

      {isManager && (
        <div className="mt-4">
          <PendingTimeOffSection
            requests={pendingManagerTimeOff}
            onApprove={handleApproveManagerTimeOff}
            onDeny={handleDenyManagerTimeOff}
          />
        </div>
      )}
    </>
  );

  return (
    <AppShell
      active="schedule"
      isManager={isManager}
      userName={sharedLoading ? null : employeeName}
      isDemo={isDemo}
      onSignOut={handleSignOut}
    >
      <main className="max-w-[480px] mx-auto pb-28 bg-bg min-h-screen [@media(min-width:900px)]:max-w-none [@media(min-width:900px)]:pb-0">
        {/* Desktop header (hidden on mobile) */}
        <div className="hidden [@media(min-width:900px)]:flex border-b border-slate-800 px-6 py-[14px] items-center justify-between">
          <div>
            <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">My Schedule</div>
            <div className="text-xl font-extrabold text-slate-100 mt-0.5">{firstName}</div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-400">{todayStr}</span>
            <NotificationBell />
            <UserMenu
              name={sharedLoading ? null : employeeName}
              onSignOut={handleSignOut}
            />
          </div>
        </div>

        {/*
         * Content: single DOM tree, CSS-responsive layout.
         * Mobile: vertical stack (nextShift → calendar → detail).
         * Desktop: 2-column grid — explicit col/row placement reorders without
         * duplicating React elements (which would cause double state/effects).
         * nextShiftCard and detailSection go in col 2; calendarSection fills col 1.
         */}
        <div className="flex flex-col px-4 pt-4 [@media(min-width:900px)]:grid [@media(min-width:900px)]:grid-cols-[1fr_320px] [@media(min-width:900px)]:gap-6 [@media(min-width:900px)]:px-6 [@media(min-width:900px)]:py-6 [@media(min-width:900px)]:items-start">
          {/* Mobile: 1st. Desktop: col 2, row 1 (sticky) */}
          <div className="[@media(min-width:900px)]:col-start-2 [@media(min-width:900px)]:row-start-1 [@media(min-width:900px)]:sticky [@media(min-width:900px)]:top-6">
            {nextShiftCard}
          </div>
          {/* Mobile: 2nd. Desktop: col 1, rows 1–2 */}
          <div className="[@media(min-width:900px)]:col-start-1 [@media(min-width:900px)]:row-start-1 [@media(min-width:900px)]:row-span-2">
            {calendarSection}
          </div>
          {/* Mobile: 3rd. Desktop: col 2, row 2 */}
          <div className="[@media(min-width:900px)]:col-start-2 [@media(min-width:900px)]:row-start-2">
            {detailSection}
          </div>
        </div>

        <DatePickerSheet
          open={pickerOpen}
          selected={selectedDate}
          today={today}
          firstDayOfWeek={firstDayOfWeek}
          onSelect={handlePickerSelect}
          onClose={() => setPickerOpen(false)}
        />

        {isManager && (
          <SwapRequestsDrawer
            open={swapDrawerOpen}
            onClose={() => setSwapDrawerOpen(false)}
            swaps={pendingSwaps}
            onApprove={handleApproveSwap}
            onDeny={handleDenySwap}
          />
        )}

        <SwapRequestSheet
          open={swapSheetOpen}
          onClose={() => setSwapSheetOpen(false)}
          dateLabel={selectedDayLabel}
          myShiftTime={selectedSchedule ? `${fmtMinutes(selectedSchedule.startMinutes)} – ${fmtMinutes(selectedSchedule.endMinutes)}` : ""}
          coworkers={swapCoworkers}
          loading={swapLoading}
          error={swapLoadError}
          submitting={swapSubmitting}
          submitError={swapSubmitError}
          onSelect={submitSwap}
        />

        <BottomNav active="schedule" />
      </main>
    </AppShell>
  );
}
