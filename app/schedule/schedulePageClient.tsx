"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { motion, LayoutGroup } from "framer-motion";
import { useRouter } from "next/navigation";
import {
  Schedule,
  TimeOffRequest,
  Callout,
  Employee,
  PunchRecord,
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
import RequestsDrawer from "../../components/RequestsDrawer";
import SwapRequestSheet, { type CoworkerShift } from "../../components/SwapRequestSheet";
import IncomingSwapRequests from "../../components/IncomingSwapRequests";
import { addDaysToKey, dateFromKey, dateKeyInTz, daysBetweenKeys, formatDateKey, formatTimeInTz, localDateKey, nowMinutesInTz } from "@/lib/dates";
import { shiftWindowOn } from "@/lib/shift-times";
import { mapSwap, type Swap, type RawSwap } from "@/lib/swaps";
import type { PunchCorrection } from "@/app/api/punch-corrections/route";

const PUNCH_TYPE_LABELS: Record<PunchCorrection["punchType"], string> = {
  clock_in:    "Clock In",
  clock_out:   "Clock Out",
  break_start: "Break Start",
  break_end:   "Break End",
};
import { useStoreTodayKey } from "@/hooks/useStoreTodayKey";
import { BREAKPOINTS } from "@/hooks/useBreakpoint";
import { shiftMinutes } from "@/lib/schedule-hours";
import { calloutBlockReason } from "@/lib/callout-rules";
import { Toast, ToastStack } from "../../components/Toast";

type ManagerTimeOffRequest = {
  id: number;
  employeeName: string;
  date: string;
  note?: string;
  status: string;
};

type View = "week" | "month";

export function isShiftUpcoming(
  shift: { date: string; endMinutes: number; startMinutes: number },
  todayKey: string,
  nowMinutes: number,
): boolean {
  // An overnight shift from yesterday is still upcoming until it ends this morning.
  return shiftWindowOn(shift, todayKey).end > nowMinutes;
}

export function formatNextShiftDate(dateStr: string, todayKey: string): string {
  if (dateStr === todayKey) return "Today";
  if (dateStr === addDaysToKey(todayKey, -1)) return "Since last night";
  if (dateStr === addDaysToKey(todayKey, 1)) return "Tomorrow";
  return formatDateKey(dateStr, { weekday: "long", month: "long", day: "numeric" });
}

export function getDaysUntil(dateStr: string, todayKey: string): number {
  return daysBetweenKeys(todayKey, dateStr);
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
  const { me, storeHours: weeklyHours, settings, myScheduleCache, setMyScheduleCache, sharedLoading, cacheEmployees } = useAppData();
  const { firstDayOfWeek, timezone } = settings;
  // Dates on this page are store-local calendar days held as local-noon Date
  // objects (see lib/dates.ts); "today" is the store's today, not the device's.
  const todayKey = useStoreTodayKey(timezone);
  const today = useMemo(() => dateFromKey(todayKey), [todayKey]);
  const router = useRouter();
  const supabase = createClient();

  const [view, setView] = useState<View>("week");
  const [selectedDate, setSelectedDate] = useState(today);
  const [navDate, setNavDate] = useState(today);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);

  const { isManager, employeeId, employeeName, isDemo } = me;
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [timeOffStatus, setTimeOffStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [timeOffError, setTimeOffError] = useState<string | null>(null);
  const [timeOffRequests, setTimeOffRequests] = useState<TimeOffRequest[]>([]);
  const [myCallouts, setMyCallouts] = useState<Callout[]>([]);
  // Whether the user has clocked in at any point today (store day) — today's
  // shift can't be called out after that.
  const [clockedInToday, setClockedInToday] = useState(false);
  const [calloutStatus, setCalloutStatus] = useState<"idle" | "loading">("idle");
  const [calloutError, setCalloutError] = useState<string | null>(null);
  const [nextShift, setNextShift] = useState<Schedule | null | undefined>(undefined);
  const [pendingManagerTimeOff, setPendingManagerTimeOff] = useState<ManagerTimeOffRequest[]>([]);
  const [pendingPunchCorrections, setPendingPunchCorrections] = useState<PunchCorrection[]>([]);
  // Every in-flight swap the caller can see (their own as employee; all of the
  // org's as a manager). Categorized below into manager-approval vs. incoming.
  const [allSwaps, setAllSwaps] = useState<Swap[]>([]);
  const [swapDrawerOpen, setSwapDrawerOpen] = useState(false);
  // Employee-facing swap creation sheet.
  const [swapSheetOpen, setSwapSheetOpen] = useState(false);
  const [swapCoworkers, setSwapCoworkers] = useState<CoworkerShift[]>([]);
  const [swapLoading, setSwapLoading] = useState(false);
  const [swapLoadError, setSwapLoadError] = useState<string | null>(null);
  const [swapSubmitting, setSwapSubmitting] = useState(false);
  const [swapSubmitError, setSwapSubmitError] = useState<string | null>(null);
  const [swapRequestStatus, setSwapRequestStatus] = useState<"idle" | "success">("idle");
  // Which incoming swap (if any) is mid accept/decline, to disable its buttons.
  const [respondingSwapId, setRespondingSwapId] = useState<number | null>(null);

  // Mutable refs so realtime callbacks always see the latest navigation state
  const navDateRef = useRef(navDate);
  navDateRef.current = navDate;
  const viewRef = useRef(view);
  viewRef.current = view;
  const firstDayOfWeekRef = useRef(firstDayOfWeek);
  firstDayOfWeekRef.current = firstDayOfWeek;
  const isManagerRef = useRef(isManager);
  isManagerRef.current = isManager;

  // When the store's "today" changes (settings loaded with the store timezone,
  // or the store's midnight passed), keep a selection that was on the old
  // today pinned to the new one.
  const prevTodayKeyRef = useRef(todayKey);
  useEffect(() => {
    const prev = prevTodayKeyRef.current;
    prevTodayKeyRef.current = todayKey;
    if (prev === todayKey) return;
    setSelectedDate((sd) => (localDateKey(sd) === prev ? dateFromKey(todayKey) : sd));
    setNavDate((nd) => (localDateKey(nd) === prev ? dateFromKey(todayKey) : nd));
  }, [todayKey]);

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

  const loadPunchCorrections = useCallback(() => {
    fetch("/api/punch-corrections")
      .then((r) => r.json())
      .then(({ corrections }) => { if (Array.isArray(corrections)) setPendingPunchCorrections(corrections); })
      .catch(() => {});
  }, []);

  async function reviewPunchCorrection(id: number, status: "approved" | "denied") {
    const res = await fetch(`/api/punch-corrections/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      throw new Error(error ?? `Failed to ${status === "approved" ? "approve" : "deny"} correction`);
    }
    setPendingPunchCorrections((prev) => prev.filter((r) => r.id !== id));
  }

  const loadSwaps = useCallback(() => {
    fetch("/api/swaps")
      .then((r) => r.json())
      .then((data: RawSwap[]) => {
        if (Array.isArray(data)) setAllSwaps(data.map(mapSwap));
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
      setAllSwaps((prev) => prev.filter((s) => s.id !== id));
    } catch {
      loadSwaps();
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
      setAllSwaps((prev) => prev.filter((s) => s.id !== id));
    } catch {
      loadSwaps();
    }
  }

  // Target employee responding to an incoming request. Accepting moves it to
  // 'accepted' (now awaiting a manager); declining ends it. Either way it leaves
  // the caller's actionable list, so drop it locally and resync.
  async function respondToSwap(id: number, status: "accepted" | "declined") {
    setRespondingSwapId(id);
    try {
      const res = await fetch(`/api/swaps/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      // Reflect the new state (declined drops out; accepted stays as 'accepted').
      setAllSwaps((prev) =>
        status === "declined"
          ? prev.filter((s) => s.id !== id)
          : prev.map((s) => (s.id === id ? { ...s, status: "accepted" } : s)),
      );
    } catch {
      loadSwaps();
    } finally {
      setRespondingSwapId(null);
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
      loadSwaps();
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

  const loadClockedInToday = useCallback(() => {
    if (employeeId === null) return;
    fetch(`/api/punches?date=${todayKey}`)
      .then((r) => r.json())
      .then((punches: PunchRecord[]) => {
        if (!Array.isArray(punches)) return;
        setClockedInToday(punches.some((p) => p.employeeId === employeeId && p.punchType === "clock_in"));
      })
      .catch(() => {});
  }, [employeeId, todayKey]);

  // Refresh on load, at the store's midnight (todayKey changes), and when the
  // tab comes back — e.g. after clocking in on the Clock screen or another device.
  useEffect(() => {
    loadClockedInToday();
    const onVisible = () => { if (document.visibilityState === "visible") loadClockedInToday(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadClockedInToday]);

  // Load pending punch corrections once manager status is known
  useEffect(() => {
    if (isManager) loadPunchCorrections();
  }, [isManager, loadPunchCorrections]);

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
  // every active swap in the org (categorized into accepted-awaiting-approval
  // and incoming), while employees get only their own (their incoming requests,
  // per-shift status badge, and dedupe).
  useEffect(() => {
    loadSwaps();
  }, [loadSwaps]);

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
    const fromKey = localDateKey(from);
    const toKey = localDateKey(to);
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
  }, [view, navDate, firstDayOfWeek]);

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
    const nowMinutes = nowMinutesInTz(timezone);
    const toKey = addDaysToKey(todayKey, 30);
    fetch(`/api/my-schedule?from=${addDaysToKey(todayKey, -1)}&to=${toKey}`)
      .then((r) => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data) => {
        if (cancelled) return;
        const upcoming = (data.schedules ?? [])
          .filter((s: Schedule) => isShiftUpcoming(s, todayKey, nowMinutes))
          .sort((a: Schedule, b: Schedule) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMinutes - b.startMinutes));
        setNextShift(upcoming[0] ?? null);
      })
      .catch(() => { if (!cancelled) setNextShift(null); });
    return () => { cancelled = true; };
  }, [employeeId, timezone, todayKey]);

  // Supabase Realtime — live updates for schedule, time-off, store hours, settings
  useEffect(() => {
    function refetchSchedule() {
      const nd = navDateRef.current;
      const v = viewRef.current;
      const fdw = firstDayOfWeekRef.current;
      let from: Date, to: Date;
      if (v === "week") {
        const ws = getWeekStart(nd, fdw);
        from = ws;
        to = offsetDays(ws, 6);
      } else {
        from = new Date(nd.getFullYear(), nd.getMonth(), 1);
        to = new Date(nd.getFullYear(), nd.getMonth() + 1, 0);
      }
      const fk = localDateKey(from);
      const tk = localDateKey(to);
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
      loadSwaps();
    }

    function refetchPunchCorrections() {
      if (isManagerRef.current) loadPunchCorrections();
    }

    let hiddenAt = 0;
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (Date.now() - hiddenAt > 5_000) {
        refetchSchedule();
        refetchTimeOff();
        refetchSwaps();
        refetchPunchCorrections();
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
      .on("postgres_changes", { event: "*", schema: "public", table: "punch_corrections" }, refetchPunchCorrections)
      .subscribe();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      supabase.removeChannel(channel);
    };
  }, [loadSwaps]);

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

  const isAtToday =
    view === "week"
      ? todayKey >= localDateKey(weekStart) && todayKey <= localDateKey(weekEnd)
      : navDate.getFullYear() === today.getFullYear() && navDate.getMonth() === today.getMonth();

  const rangeLabel =
    view === "week"
      ? formatWeekRange(weekStart, weekEnd)
      : navDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const selectedDateKey = localDateKey(selectedDate);
  const selectedSchedule =
    schedules.find((s) => s.date.slice(0, 10) === selectedDateKey) ?? null;

  const selectedDayHours = weeklyHours[selectedDate.getDay()] ?? { open: 360, close: 1320 };
  const shiftType = selectedSchedule
    ? getShiftType(selectedSchedule.startMinutes, selectedSchedule.endMinutes, selectedDayHours.open, selectedDayHours.close)
    : null;
  const shiftColor = shiftType ? SHIFT_COLORS[shiftType] : null;
  const shiftLabel = shiftType ? SHIFT_TYPE_LABELS[shiftType] : null;
  const shiftHours = selectedSchedule ? shiftMinutes(selectedSchedule, timezone) / 60 : null;

  const isSelectedToday = selectedDateKey === todayKey;
  const selectedDayLabel = isSelectedToday
    ? "Today"
    : selectedDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });

  const selectedTimeOff = timeOffRequests.find((r) => r.date === selectedDateKey) ?? null;

  const calloutDates = useMemo(() => myCallouts.map((c) => c.date), [myCallouts]);
  const selectedCallout = myCallouts.find((c) => c.date === selectedDateKey) ?? null;

  // Show "Call Out" only for the user's own shift today or tomorrow, not once
  // they've clocked in for today's shift, and not if already called out — the
  // same rule the server enforces (lib/callout-rules.ts).
  const canCallOut =
    !selectedCallout &&
    employeeId !== null &&
    calloutBlockReason({
      date: selectedDateKey,
      todayKey,
      hasShift: !!selectedSchedule,
      clockedInToday,
    }) === null;

  // Show "Request Day Off" when: no shift, future date, has employeeId, no existing pending/approved request
  const canRequestDayOff =
    !selectedSchedule &&
    selectedDateKey > todayKey &&
    employeeId !== null &&
    selectedTimeOff?.status !== "pending" &&
    selectedTimeOff?.status !== "approved";

  // Swaps awaiting a manager's decision — the only ones a manager may act on,
  // since the target has already accepted. Drives the drawer + its count.
  const managerSwaps = useMemo(
    () => allSwaps.filter((s) => s.status === "accepted"),
    [allSwaps],
  );

  // Total pending items a manager must act on (swaps, time off, punch
  // corrections), badged on the Requests button.
  const pendingRequestsCount = managerSwaps.length + pendingManagerTimeOff.length + pendingPunchCorrections.length;

  // Display-ready punch corrections, in the store's timezone.
  const punchCorrectionItems = useMemo(
    () => pendingPunchCorrections.map((c) => ({
      id: c.id,
      employeeName: c.employeeName,
      punchLabel: PUNCH_TYPE_LABELS[c.punchType],
      when: `${formatDateKey(dateKeyInTz(c.punchedAt, timezone), { weekday: "short", month: "short", day: "numeric" })} at ${formatTimeInTz(c.punchedAt, timezone)}`,
      note: c.note,
    })),
    [pendingPunchCorrections, timezone],
  );

  // Swaps the current user is personally part of, as requester or target.
  const mySwaps = useMemo(
    () => allSwaps.filter((s) => s.requesterId === employeeId || s.targetId === employeeId),
    [allSwaps, employeeId],
  );

  // Incoming requests this user must accept or decline: they're the target and
  // it's still awaiting their response.
  const incomingSwaps = useMemo(
    () => allSwaps.filter((s) => s.targetId === employeeId && s.status === "pending"),
    [allSwaps, employeeId],
  );

  // An active swap tied to the selected shift, from this user's perspective —
  // either pending the target's answer or accepted and awaiting a manager.
  const selectedShiftSwap = selectedSchedule
    ? mySwaps.find((s) => s.scheduleAId === selectedSchedule.id || s.scheduleBId === selectedSchedule.id) ?? null
    : null;

  const selectedSwapBadge = (() => {
    if (!selectedShiftSwap) return null;
    if (selectedShiftSwap.status === "accepted") return "Swap awaiting manager approval";
    return selectedShiftSwap.requesterId === employeeId
      ? "Swap awaiting coworker's response"
      : "Swap needs your response";
  })();

  // Offer "Request Shift Swap" when the user owns a shift on a today-or-future
  // day and it isn't already mid-swap. (The target must accept and then a
  // manager must approve — this only creates the pending request.)
  const canRequestSwap =
    selectedSchedule !== null &&
    selectedDateKey >= todayKey &&
    employeeId !== null &&
    !selectedShiftSwap;

  // Stats
  const totalShifts = schedules.length;
  const totalHours = schedules.reduce((acc, s) => acc + shiftMinutes(s, timezone) / 60, 0);
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
            {formatNextShiftDate(nextShift.date, todayKey)}
          </div>
          <div className="text-2xl font-extrabold text-slate-100 mt-1">
            {fmtMinutes(nextShift.startMinutes)} – {fmtMinutes(nextShift.endMinutes)}
          </div>
          {getDaysUntil(nextShift.date, todayKey) > 1 && (
            <div className="text-xs text-slate-400 mt-1">
              in {getDaysUntil(nextShift.date, todayKey)} days
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
              {calloutStatus === "loading" ? "Submitting…" : "Can't make this shift? Call out"}
            </button>
          </div>
        ) : null}

        {/* Shift swap status / action */}
        {selectedSwapBadge ? (
          <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-xl bg-yellow-500/10 border border-yellow-500/30">
            <TimeOffPendingIcon size={16} color="rgb(250 204 21)" />
            <span className="text-sm text-yellow-300 font-semibold">{selectedSwapBadge}</span>
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

      {/* Incoming swap requests this user must accept or decline */}
      <IncomingSwapRequests
        swaps={incomingSwaps}
        respondingId={respondingSwapId}
        onAccept={(id) => respondToSwap(id, "accepted")}
        onDecline={(id) => respondToSwap(id, "declined")}
      />

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
          onClick={() => router.push("/week?mode=draft")}
          whileTap={{ scale: 0.98 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          className="w-full mt-4 py-3 text-sm font-bold text-white bg-gradient-to-r from-blue-500 to-violet-500 border-none rounded-xl cursor-pointer hover:brightness-110 transition-all"
        >
          Plan Draft Schedule
        </motion.button>
      )}

      {isManager && (
        <button
          // Phones review requests in the drawer; wider screens get the full inbox page.
          onClick={() => (window.matchMedia(`(min-width: ${BREAKPOINTS.tablet}px)`).matches ? router.push("/requests") : setSwapDrawerOpen(true))}
          className="w-full mt-3 py-3 text-sm font-bold text-slate-200 bg-card border border-slate-800/60 rounded-xl cursor-pointer hover:border-indigo-500/50 transition-colors flex items-center justify-center gap-2"
        >
          Requests
          {pendingRequestsCount > 0 && (
            <span className="bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-px text-[11px] text-amber-400">
              {pendingRequestsCount}
            </span>
          )}
        </button>
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
      <main className="max-w-[480px] mx-auto tablet:max-w-none tablet:pb-10 pb-28 bg-bg min-h-dvh desk:max-w-none desk:pb-0">
        {/* Desktop header (hidden on mobile) */}
        <div className="hidden desk:flex border-b border-slate-800 px-6 py-[14px] items-center justify-between">
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
         * Tablet: next shift full width, then calendar | day detail.
         * Desktop: 2-column grid — explicit col/row placement reorders without
         * duplicating React elements (which would cause double state/effects).
         * nextShiftCard and detailSection go in col 2; calendarSection fills col 1.
         */}
        <div className="flex flex-col px-4 pt-4 tablet:grid tablet:grid-cols-2 tablet:gap-x-6 tablet:px-6 tablet:items-start desk:grid desk:grid-cols-[1fr_320px] desk:gap-6 desk:px-6 desk:py-6 desk:items-start wide:grid-cols-[minmax(0,1fr)_380px] wide:max-w-[1680px] wide:mx-auto">
          {/* Mobile: 1st. Desktop: col 2, row 1 (sticky) */}
          <div className="tablet:col-span-2 desk:col-span-1 desk:col-start-2 desk:row-start-1 desk:sticky desk:top-6">
            {nextShiftCard}
          </div>
          {/* Mobile: 2nd. Desktop: col 1, rows 1–2 */}
          <div className="min-w-0 desk:col-start-1 desk:row-start-1 desk:row-span-2">
            {calendarSection}
          </div>
          {/* Mobile: 3rd. Desktop: col 2, row 2 */}
          <div className="min-w-0 desk:col-start-2 desk:row-start-2">
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
          <RequestsDrawer
            open={swapDrawerOpen}
            onClose={() => setSwapDrawerOpen(false)}
            swaps={managerSwaps}
            timeOff={pendingManagerTimeOff}
            punchCorrections={punchCorrectionItems}
            onApproveSwap={handleApproveSwap}
            onDenySwap={handleDenySwap}
            onApproveTimeOff={handleApproveManagerTimeOff}
            onDenyTimeOff={handleDenyManagerTimeOff}
            onApprovePunchCorrection={(id) => reviewPunchCorrection(id, "approved")}
            onDenyPunchCorrection={(id) => reviewPunchCorrection(id, "denied")}
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

        {/* Failed requests show over the page, not inside the day card, so
            the card doesn't grow under the button that was just tapped. */}
        <ToastStack>
          {timeOffStatus === "error" && timeOffError && (
            <Toast onDismiss={() => { setTimeOffError(null); setTimeOffStatus("idle"); }}>{timeOffError}</Toast>
          )}
          {calloutError && <Toast onDismiss={() => setCalloutError(null)}>{calloutError}</Toast>}
        </ToastStack>

        <BottomNav active="schedule" />
      </main>
    </AppShell>
  );
}
