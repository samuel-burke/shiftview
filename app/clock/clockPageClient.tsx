"use client";

import { downloadCSV } from "../../lib/csv-download";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Schedule,
  PunchRecord,
  PunchType,
  AttendanceStatus,
  StoreHours,
  getAttendanceStatus,
  getTotalClockedSeconds,
  fmtElapsed,
  fmtMinutes,
  getShiftType,
  SHIFT_COLORS,
} from "../../data/types";
import BottomNav from "../../components/BottomNav";
import AppShell from "../../components/AppShell";
import NotificationBell from "../../components/NotificationBell";
import UserMenu from "../../components/UserMenu";
import { useIsDesktop } from "../../hooks/useIsDesktop";
import { createClient } from "@/lib/supabase-browser";
import { getPunchWarning, type PunchWarning } from "@/lib/punch-warning";
import { SkeletonClockBody } from "../../components/Skeleton";
import { haversineMeters } from "@/lib/haversine";
import { motion } from "framer-motion";
import { DEMO_EMPLOYEES, DEMO_SETTINGS, DEMO_STORE_HOURS, getDemoSchedulesForDate } from "../../data/demo-fixtures";

const DEMO_EMPLOYEE = DEMO_EMPLOYEES[0]; // Jordan Martinez, id 1

const listContainer = { hidden: {}, show: { transition: { staggerChildren: 0.055 } } };
const listItem = { hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 320, damping: 26 } } };

function toDateKey(d: Date) {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function getNowMinutes() {
  const now = new Date();
  const parts = now.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const [h, m] = parts.split(":").map(Number);
  return h * 60 + m;
}



const STATUS_LABELS: Record<AttendanceStatus, string> = {
  clocked_in:    "Clocked In",
  on_break:      "On Break",
  clocked_out:   "Clocked Out",
  not_clocked_in: "Not Clocked In",
};

const STATUS_COLORS: Record<AttendanceStatus, string> = {
  clocked_in:    "#22c55e",
  on_break:      "#f59e0b",
  clocked_out:   "#94a3b8",
  not_clocked_in: "#94a3b8",
};

const PUNCH_TYPE_LABELS: Record<PunchType, string> = {
  clock_in:    "Clock In",
  clock_out:   "Clock Out",
  break_start: "Break Start",
  break_end:   "Break End",
};

function formatPunchTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function ClockPageClient() {
  const today = new Date();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isDemo = searchParams.get("demo") === "true";
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [punches, setPunches] = useState<PunchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nowMinutes, setNowMinutes] = useState(getNowMinutes);
  const [elapsed, setElapsed] = useState(0);
  const [employeeName, setEmployeeName] = useState<string | null>(null);
  const [isManager, setIsManager] = useState(false);
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [weeklyHours, setWeeklyHours] = useState<Record<number, StoreHours>>({
    0: { open: 480, close: 1200 },
    1: { open: 360, close: 1320 },
    2: { open: 360, close: 1320 },
    3: { open: 360, close: 1320 },
    4: { open: 360, close: 1320 },
    5: { open: 360, close: 1320 },
    6: { open: 360, close: 1320 },
  });

  // Correction form state
  const [showCorrection, setShowCorrection] = useState(false);
  const [correctionType, setCorrectionType] = useState<PunchType>("clock_in");
  const [correctionDate, setCorrectionDate] = useState(toDateKey(today));
  const [correctionTime, setCorrectionTime] = useState("09:00");
  const [correctionNote, setCorrectionNote] = useState("");
  const [correctionSaving, setCorrectionSaving] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);

  // Export state
  const [exportFrom, setExportFrom] = useState(toDateKey(today));
  const [exportTo, setExportTo] = useState(toDateKey(today));
  const [showExport, setShowExport] = useState(false);

  async function handleExportDownload() {
    const res = await fetch(`/api/punches/export?from=${exportFrom}&to=${exportTo}`);
    const blob = await res.blob();
    await downloadCSV(blob, `timesheet_${exportFrom}_to_${exportTo}.csv`);
  }

  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [gpsStatus, setGpsStatus] = useState<"idle" | "acquiring" | "ok" | "denied">("idle");

  // Pre-punch warning confirmation
  const [pendingPunchType, setPendingPunchType] = useState<PunchType | null>(null);
  const [pendingWarning, setPendingWarning] = useState<PunchWarning | null>(null);

  // Time clock settings
  const [manualPunchesEnabled, setManualPunchesEnabled] = useState(true);
  const [gpsRequired, setGpsRequired] = useState(false);
  const [geofenceEnabled, setGeofenceEnabled] = useState(false);
  const [geofenceLat, setGeofenceLat] = useState<number | null>(null);
  const [geofenceLng, setGeofenceLng] = useState<number | null>(null);
  const [geofenceRadius, setGeofenceRadius] = useState(100);
  const [geofenceAddress, setGeofenceAddress] = useState<string | null>(null);

  const todayKey = toDateKey(today);
  const storeHours = weeklyHours[today.getDay()];

  const status = getAttendanceStatus(punches);

  // Allow clock-in whenever the last punch was a clock_out (or there are no punches).
  // The only gate on Clock In is: last punch must be null or clock_out.
  const effectiveStatus = useMemo((): AttendanceStatus => {
    if (status === "clocked_out") return "not_clocked_in";
    return status;
  }, [status]);

  // Live elapsed clock — ticks every second when clocked in or on break (tracking active work)
  useEffect(() => {
    setElapsed(getTotalClockedSeconds(punches));
    if (status === "clocked_in") {
      const t = setInterval(() => setElapsed(getTotalClockedSeconds(punches)), 1000);
      return () => clearInterval(t);
    }
  }, [punches, status]);

  // Live nowMinutes for shift status
  useEffect(() => {
    const t = setInterval(() => setNowMinutes(getNowMinutes()), 60000);
    return () => clearInterval(t);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isDemo) {
        setIsManager(true);
        setEmployeeName(DEMO_EMPLOYEE.name);
        setEmployeeId(DEMO_EMPLOYEE.id);
        const scheds = getDemoSchedulesForDate(todayKey);
        setSchedule(scheds.find((s) => s.employeeId === DEMO_EMPLOYEE.id) ?? null);
        setPunches([]);
        setWeeklyHours(DEMO_STORE_HOURS);
        setManualPunchesEnabled(DEMO_SETTINGS.manualPunchesEnabled);
        setGpsRequired(DEMO_SETTINGS.gpsRequired);
        setGeofenceEnabled(DEMO_SETTINGS.geofenceEnabled);
        return;
      }

      const [meRes, schedRes, punchRes, hoursRes, settingsRes] = await Promise.all([
        fetch("/api/me"),
        fetch(`/api/schedules?date=${todayKey}`),
        fetch(`/api/punches?date=${todayKey}`),
        fetch("/api/store-hours"),
        fetch("/api/settings"),
      ]);

      const me = await meRes.json();
      setIsManager(!!me.isManager);
      setEmployeeName(me.employeeName ?? null);
      setEmployeeId(me.employeeId ?? null);

      const scheds: Schedule[] = await schedRes.json();
      const emp = me.employeeId;
      setSchedule(emp ? (scheds.find((s) => s.employeeId === emp) ?? null) : null);

      const punchData: PunchRecord[] = await punchRes.json();
      const empId = me.employeeId;
      const myPunches = Array.isArray(punchData)
        ? empId ? punchData.filter((p) => p.employeeId === empId) : []
        : [];
      setPunches(myPunches);

      const hours = await hoursRes.json();
      setWeeklyHours((prev) => ({ ...prev, ...hours }));

      const settings = await settingsRes.json();
      if (settings.manualPunchesEnabled != null) setManualPunchesEnabled(settings.manualPunchesEnabled);
      if (settings.gpsRequired != null) setGpsRequired(settings.gpsRequired);
      if (settings.geofenceEnabled != null) setGeofenceEnabled(settings.geofenceEnabled);
      if (settings.geofenceLat != null) setGeofenceLat(settings.geofenceLat);
      if (settings.geofenceLng != null) setGeofenceLng(settings.geofenceLng);
      if (settings.geofenceRadius != null) setGeofenceRadius(settings.geofenceRadius);
      if (settings.geofenceAddress != null) setGeofenceAddress(settings.geofenceAddress);
    } catch {
      setError("Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [todayKey, isDemo]);

  useEffect(() => { loadData(); }, [loadData]);

  // Supabase Realtime — reload when schedule, punches, settings, or store hours change
  useEffect(() => {
    if (isDemo) return;
    const channel = supabase
      .channel("clock-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "schedules" }, () => loadData())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "punch_records" }, () => loadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, () => loadData())
      .on("postgres_changes", { event: "*", schema: "public", table: "store_hours" }, () => loadData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isDemo, loadData]);

  async function getGps(): Promise<{ lat: number; lng: number } | null> {
    if (!navigator.geolocation) return null;
    return new Promise((resolve) => {
      setGpsStatus("acquiring");
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setGpsStatus("ok");
          resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        () => {
          setGpsStatus("denied");
          resolve(null);
        },
        { timeout: 8000 }
      );
    });
  }

  function handlePunchClick(punchType: PunchType) {
    const warning = getPunchWarning(punchType, nowMinutes, schedule);
    if (warning) {
      setPendingPunchType(punchType);
      setPendingWarning(warning);
    } else {
      submitPunch(punchType);
    }
  }

  function confirmPunch() {
    if (pendingPunchType) submitPunch(pendingPunchType);
    setPendingPunchType(null);
    setPendingWarning(null);
  }

  function cancelPunch() {
    setPendingPunchType(null);
    setPendingWarning(null);
  }

  const demoPunchIdRef = useRef(-1);

  async function submitPunch(punchType: PunchType) {
    if (actionPending) return;
    setActionPending(true);
    setActionError(null);

    if (isDemo) {
      await new Promise((r) => setTimeout(r, 350));
      const fakePunch: PunchRecord = {
        id: demoPunchIdRef.current--,
        employeeId: DEMO_EMPLOYEE.id,
        scheduleId: schedule?.id ?? null,
        punchType,
        punchedAt: new Date().toISOString(),
        lat: null,
        lng: null,
        isManual: false,
        note: null,
      };
      setPunches((prev) => [...prev, fakePunch]);
      setActionPending(false);
      return;
    }

    let lat: number | null = null;
    let lng: number | null = null;

    if (punchType === "clock_in" && gpsRequired) {
      const gps = await getGps();
      if (!gps) {
        setActionError("GPS location is required to clock in. Please enable location access.");
        setActionPending(false);
        return;
      }
      lat = gps.lat;
      lng = gps.lng;

      if (geofenceEnabled && geofenceLat !== null && geofenceLng !== null) {
        const dist = haversineMeters(lat, lng, geofenceLat, geofenceLng);
        if (dist > geofenceRadius) {
          const place = geofenceAddress ?? "the designated location";
          setActionError(
            `You must be within ${geofenceRadius}m of ${place} to clock in. You are currently ${Math.round(dist)}m away.`
          );
          setActionPending(false);
          return;
        }
      }
    }

    try {
      const res = await fetch("/api/punches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          punchType,
          scheduleId: schedule?.id ?? null,
          lat,
          lng,
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to record punch");
      }
      const newPunch: PunchRecord = await res.json();
      setPunches((prev) => [...prev, newPunch]);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setActionPending(false);
    }
  }

  async function submitCorrection() {
    if (!correctionNote.trim()) {
      setCorrectionError("A note is required for manual corrections");
      return;
    }
    if (isDemo) {
      setShowCorrection(false);
      setCorrectionNote("");
      return;
    }
    setCorrectionSaving(true);
    setCorrectionError(null);
    try {
      const punchedAt = new Date(`${correctionDate}T${correctionTime}:00`).toISOString();
      const res = await fetch("/api/punches", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          punchType: correctionType,
          punchedAt,
          note: correctionNote.trim(),
          scheduleId: schedule?.id ?? null,
          employeeId: isManager ? employeeId : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Failed to save correction");
      }
      setShowCorrection(false);
      setCorrectionNote("");
      await loadData();
    } catch (e) {
      setCorrectionError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setCorrectionSaving(false);
    }
  }

  // Derive late / early status
  let punchFlair: { text: string; color: string } | null = null;
  if (schedule && punches.length > 0) {
    const clockIn = [...punches]
      .sort((a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime())
      .find((p) => p.punchType === "clock_in");
    if (clockIn) {
      const clockInMinutes =
        new Date(clockIn.punchedAt).getHours() * 60 +
        new Date(clockIn.punchedAt).getMinutes();
      const diff = clockInMinutes - schedule.startMinutes;
      if (diff > 5) punchFlair = { text: `${diff}m late`, color: "#ef4444" };
      else if (diff < -5) punchFlair = { text: `${Math.abs(diff)}m early`, color: "#818cf8" };
    }
  }

  const shiftType = schedule
    ? getShiftType(schedule.startMinutes, schedule.endMinutes, storeHours.open, storeHours.close)
    : null;
  const shiftColor = shiftType ? SHIFT_COLORS[shiftType] : "#818cf8";

  const firstName = employeeName ? employeeName.split(" ")[0] : "Clock";
  const isDesktop = useIsDesktop();

  const clockHeader = (
    <div
      className={`${isDesktop ? "border-b border-slate-800 px-6 py-[14px]" : "sticky top-0 z-20 px-0 pb-3 border-b border-slate-800 bg-bg"} flex items-center justify-between`}
      style={isDesktop ? {} : { paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}
    >
      <div>
        <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">Time Clock</div>
        <div className={`font-extrabold text-slate-100 leading-tight mt-0.5 ${isDesktop ? "text-xl" : "text-[28px]"}`}>{firstName}</div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-400">
          {today.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
        </span>
        {!isDemo && <NotificationBell />}
        <UserMenu
          name={employeeName}
          isManager={isManager}
          onSignOut={isDemo ? undefined : handleSignOut}
          onSignIn={isDemo ? () => router.push("/login") : undefined}
        />
      </div>
    </div>
  );

  if (loading) {
    return (
      <AppShell active="clock" isManager={isManager}>
        <main className={`${isDesktop ? "bg-bg min-h-screen" : "max-w-[480px] mx-auto px-4 pb-28 bg-bg min-h-screen"}`}>
          {isDesktop ? (
            <div className="border-b border-slate-800 px-6 py-[14px] flex items-center justify-between">
              <div>
                <div className="skeleton h-[10px] w-20 rounded mb-1.5" />
                <div className="skeleton h-7 w-28 rounded" />
              </div>
              <div className="skeleton h-8 w-28 rounded-xl" />
            </div>
          ) : (
            <div className="sticky top-0 z-20 px-0 pb-3 flex items-center justify-between border-b border-slate-800 bg-bg"
              style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}>
              <div>
                <div className="skeleton h-[10px] w-20 rounded mb-1.5" />
                <div className="skeleton h-7 w-28 rounded" />
              </div>
              <div className="skeleton h-8 w-28 rounded-xl" />
            </div>
          )}
          <div className={isDesktop ? "max-w-[600px] mx-auto px-6 py-6" : ""}>
            <SkeletonClockBody />
          </div>
          {!isDesktop && <BottomNav active="clock" />}
        </main>
      </AppShell>
    );
  }

  // Employee not linked
  if (!employeeId && !isManager) {
    return (
      <AppShell active="clock" isManager={isManager}>
        <main className={`${isDesktop ? "bg-bg min-h-screen" : "max-w-[480px] mx-auto px-4 pb-28 bg-bg min-h-screen"}`}>
          {isDesktop ? (
            <div className="border-b border-slate-800 px-6 py-[14px]">
              <span className="text-xl font-extrabold text-slate-100 tracking-tight">Time Clock</span>
            </div>
          ) : (
            <div className="sticky top-0 z-20 px-0 pb-3 flex items-center justify-between border-b border-slate-800 bg-bg"
              style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}>
              <span className="text-2xl font-extrabold text-slate-100 tracking-tight">
                Time<span className="bg-gradient-to-r from-blue-500 to-violet-500 bg-clip-text text-transparent">Clock</span>
              </span>
            </div>
          )}
          <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3 text-center px-4">
            <div aria-hidden="true" className="text-4xl">🔗</div>
            <div className="text-lg font-bold text-slate-100">Account not linked</div>
            <div className="text-sm text-slate-400 max-w-xs">Your account isn&apos;t linked to an employee record yet. Contact your manager to get set up.</div>
          </div>
          {!isDesktop && <BottomNav active="clock" />}
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell active="clock" isManager={isManager}>
    <main className={`${isDesktop ? "bg-bg min-h-screen" : "max-w-[480px] mx-auto px-4 pb-28 bg-bg min-h-screen"}`}>
      {isDemo && (
        <div className="bg-blue-500/8 border-b border-blue-500/15 px-4 py-1.5 flex items-center justify-between">
          <span className="text-[11px] text-blue-400/80 font-medium">Demo Mode · Changes are not saved</span>
          <a href="/login" className="text-[11px] font-bold text-blue-400 hover:text-blue-300 transition-colors">Sign In →</a>
        </div>
      )}
      {clockHeader}

      <div className={isDesktop ? "max-w-[600px] mx-auto px-6 py-4" : ""}>
      {error && (
        <div role="alert" className="mt-3 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 text-center">
          {error}
        </div>
      )}

      <div className="mt-4 space-y-3">
        {/* Today's shift card */}
        <div
          className="bg-card rounded-2xl px-4 py-4 border border-slate-800/60"
          style={{ borderLeft: `3px solid ${shiftColor}` }}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Today&apos;s Shift</span>
            {shiftType && (
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize"
                style={{ background: `${shiftColor}22`, color: shiftColor }}>
                {shiftType}
              </span>
            )}
          </div>
          {schedule ? (
            <div className="mt-1.5 text-2xl font-bold text-slate-100">
              {fmtMinutes(schedule.startMinutes)} – {fmtMinutes(schedule.endMinutes)}
            </div>
          ) : (
            <div className="mt-1.5 text-xl font-bold text-slate-400">No shift scheduled today</div>
          )}
          {punchFlair && (
            <div className="mt-1 text-xs font-semibold" style={{ color: punchFlair.color }}>
              {punchFlair.text}
            </div>
          )}
        </div>

        {/* Status + elapsed timer */}
        <div className="bg-card rounded-2xl px-4 py-5 border border-slate-800/60 text-center">
          <div
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-bold mb-3"
            style={{
              background: `${STATUS_COLORS[effectiveStatus]}22`,
              color: STATUS_COLORS[effectiveStatus],
              border: `1px solid ${STATUS_COLORS[effectiveStatus]}44`,
            }}
          >
            <span
              className="size-2 rounded-full"
              style={{
                background: STATUS_COLORS[effectiveStatus],
                boxShadow: effectiveStatus === "clocked_in" ? `0 0 6px ${STATUS_COLORS[effectiveStatus]}` : "none",
              }}
            />
            {STATUS_LABELS[effectiveStatus]}
          </div>

          {(effectiveStatus === "clocked_in" || effectiveStatus === "on_break" || effectiveStatus === "clocked_out") && (
            <>
              <div
                className="text-4xl font-mono font-extrabold text-slate-100 tabular-nums"
                aria-live="polite"
                aria-label={`Total time worked today: ${fmtElapsed(elapsed)}`}
              >
                {fmtElapsed(elapsed)}
              </div>
              <div className="text-xs text-slate-400 mt-1" aria-hidden="true">Total time worked today</div>
            </>
          )}

          {gpsStatus === "acquiring" && (
            <div role="status" className="text-xs text-slate-400 mt-2">Acquiring GPS…</div>
          )}
          {gpsStatus === "ok" && status === "clocked_in" && (
            <div role="status" className="text-xs text-green-500 mt-2">GPS location captured</div>
          )}
          {gpsStatus === "denied" && (
            <div role="status" className="text-xs text-amber-400 mt-2">GPS unavailable — punched without location</div>
          )}
        </div>

        {/* Action buttons */}
        {actionError && (
          <div role="alert" className="px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 text-center">
            {actionError}
          </div>
        )}

        <div className="grid gap-3">
          {effectiveStatus === "not_clocked_in" && (
            <button
              onClick={() => handlePunchClick("clock_in")}
              disabled={actionPending}
              aria-busy={actionPending}
              className="w-full py-4 rounded-2xl text-lg font-extrabold bg-green-500 text-white shadow-lg shadow-green-500/20 active:scale-[0.98] transition-[transform,background-color] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer hover:bg-green-600"
            >
              {actionPending ? "…" : "Clock In"}
            </button>
          )}

          {effectiveStatus === "clocked_in" && (
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => submitPunch("break_start")}
                disabled={actionPending}
                aria-busy={actionPending}
                className="py-4 rounded-2xl text-base font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 active:scale-[0.98] transition-[transform,background-color] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer hover:bg-amber-500/30"
              >
                {actionPending ? "…" : "Start Break"}
              </button>
              <button
                onClick={() => handlePunchClick("clock_out")}
                disabled={actionPending}
                aria-busy={actionPending}
                className="py-4 rounded-2xl text-base font-bold bg-slate-700 text-slate-200 border border-slate-600 active:scale-[0.98] transition-[transform,background-color] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer hover:bg-slate-600"
              >
                {actionPending ? "…" : "End Shift"}
              </button>
            </div>
          )}

          {effectiveStatus === "on_break" && (
            <button
              onClick={() => submitPunch("break_end")}
              disabled={actionPending}
              aria-busy={actionPending}
              className="w-full py-4 rounded-2xl text-lg font-extrabold bg-amber-500 text-white shadow-lg shadow-amber-500/20 active:scale-[0.98] transition-[transform,background-color] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer hover:bg-amber-600"
            >
              {actionPending ? "…" : "End Break"}
            </button>
          )}

          {effectiveStatus === "clocked_out" && (
            <div className="text-center py-3 text-sm text-slate-400">
              Shift complete — see you next time!
            </div>
          )}
        </div>

        {/* Punch history */}
        {punches.length > 0 && (
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-[0.08em] mb-2">Today&apos;s Punches</div>
            <motion.div className="bg-card rounded-2xl border border-slate-800/60 divide-y divide-slate-800" variants={listContainer} initial="hidden" animate="show">
              {[...punches]
                .sort((a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime())
                .map((p) => (
                  <motion.div key={p.id} variants={listItem} className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span
                        aria-hidden="true"
                        className="size-2 rounded-full shrink-0"
                        style={{
                          background:
                            p.punchType === "clock_in"   ? "#22c55e" :
                            p.punchType === "clock_out"  ? "#94a3b8" :
                            p.punchType === "break_start"? "#f59e0b" :
                                                           "#818cf8",
                        }}
                      />
                      <span className="text-sm font-medium text-slate-200">
                        {PUNCH_TYPE_LABELS[p.punchType as PunchType]}
                      </span>
                      {p.isManual && (
                        <span className="text-[10px] font-semibold text-indigo-400 bg-indigo-500/10 px-2 py-px rounded-full">
                          Manual
                        </span>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-slate-300 tabular-nums">{formatPunchTime(p.punchedAt)}</div>
                      {p.note && <div className="text-[11px] text-slate-500 mt-0.5 max-w-[140px] truncate">{p.note}</div>}
                    </div>
                  </motion.div>
                ))}
            </motion.div>
          </div>
        )}

        {/* Missed punch correction — hidden when setting is disabled */}
        {manualPunchesEnabled && <div className="bg-card rounded-2xl border border-slate-800/60">
          <button
            onClick={() => setShowCorrection((v) => !v)}
            aria-expanded={showCorrection}
            aria-controls="correction-form"
            className="w-full flex items-center justify-between px-4 py-3.5 cursor-pointer hover:bg-slate-800/50 transition-colors rounded-2xl"
          >
            <span className="text-sm font-semibold text-slate-300">Report Missed Punch</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={`text-slate-500 transition-transform ${showCorrection ? "rotate-180" : ""}`}><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>

          {showCorrection && (
            <div id="correction-form" className="px-4 pb-4 space-y-3 border-t border-slate-800">
              <div className="grid grid-cols-2 gap-3 pt-3">
                <div>
                  <label htmlFor="correction-type" className="text-xs text-slate-400 block mb-1">Punch Type</label>
                  <select
                    id="correction-type"
                    value={correctionType}
                    onChange={(e) => setCorrectionType(e.target.value as PunchType)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-[10px] px-3 py-2 text-sm text-slate-100 [color-scheme:dark] focus:outline-none focus:border-indigo-500/70 transition-colors"
                  >
                    <option value="clock_in">Clock In</option>
                    <option value="clock_out">Clock Out</option>
                    <option value="break_start">Break Start</option>
                    <option value="break_end">Break End</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="correction-date" className="text-xs text-slate-400 block mb-1">Date</label>
                  <input
                    id="correction-date"
                    type="date"
                    value={correctionDate}
                    onChange={(e) => setCorrectionDate(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-[10px] px-3 py-2 text-sm text-slate-100 [color-scheme:dark] focus:outline-none focus:border-indigo-500/70 transition-colors"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="correction-time" className="text-xs text-slate-400 block mb-1">Time</label>
                <input
                  id="correction-time"
                  type="time"
                  value={correctionTime}
                  onChange={(e) => setCorrectionTime(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-[10px] px-3 py-2 text-sm text-slate-100 [color-scheme:dark] focus:outline-none focus:border-indigo-500/70 transition-colors"
                />
              </div>
              <div>
                <label htmlFor="correction-note" className="text-xs text-slate-400 block mb-1">Reason <span className="text-red-400" aria-hidden="true">*</span></label>
                <textarea
                  id="correction-note"
                  aria-required="true"
                  value={correctionNote}
                  onChange={(e) => setCorrectionNote(e.target.value)}
                  placeholder="Why is this punch being added manually?"
                  rows={2}
                  className="w-full bg-slate-800 border border-slate-700 rounded-[10px] px-3 py-2 text-sm text-slate-100 resize-none focus:outline-none focus:border-indigo-500/70 transition-colors"
                />
              </div>
              {correctionError && (
                <div role="alert" className="text-xs text-red-400">{correctionError}</div>
              )}
              <button
                onClick={submitCorrection}
                disabled={correctionSaving || !correctionNote.trim()}
                aria-busy={correctionSaving}
                className="w-full py-2.5 rounded-xl text-sm font-bold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer hover:bg-indigo-500/30 transition-colors"
              >
                {correctionSaving ? "Saving…" : "Submit Correction"}
              </button>
            </div>
          )}
        </div>}

        {/* Timesheet export */}
        <div className="bg-card rounded-2xl border border-slate-800/60">
          <button
            onClick={() => setShowExport((v) => !v)}
            aria-expanded={showExport}
            aria-controls="export-form"
            className="w-full flex items-center justify-between px-4 py-3.5 cursor-pointer hover:bg-slate-800/50 transition-colors rounded-2xl"
          >
            <span className="text-sm font-semibold text-slate-300">Export Timesheet</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={`text-slate-500 transition-transform ${showExport ? "rotate-180" : ""}`}><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>

          {showExport && (
            <div id="export-form" className="px-4 pb-4 border-t border-slate-800 pt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="export-from" className="text-xs text-slate-400 block mb-1">From</label>
                  <input
                    id="export-from"
                    type="date"
                    value={exportFrom}
                    onChange={(e) => setExportFrom(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-[10px] px-3 py-2 text-sm text-slate-100 [color-scheme:dark] focus:outline-none focus:border-indigo-500/70 transition-colors"
                  />
                </div>
                <div>
                  <label htmlFor="export-to" className="text-xs text-slate-400 block mb-1">To</label>
                  <input
                    id="export-to"
                    type="date"
                    value={exportTo}
                    onChange={(e) => setExportTo(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-[10px] px-3 py-2 text-sm text-slate-100 [color-scheme:dark] focus:outline-none focus:border-indigo-500/70 transition-colors"
                  />
                </div>
              </div>
              <button
                onClick={handleExportDownload}
                className="block w-full py-2.5 rounded-xl text-sm font-bold text-center bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 cursor-pointer hover:bg-indigo-500/30 transition-colors"
              >
                Download CSV
              </button>
            </div>
          )}
        </div>
      </div>
      </div>

      {!isDesktop && <BottomNav active="clock" />}

      {/* Pre-punch warning modal */}
      {pendingWarning && pendingPunchType && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="punch-warning-heading"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm"
          onClick={cancelPunch}
        >
          <div
            className="w-full max-w-[480px] bg-card rounded-t-3xl border border-slate-700 px-6 pt-6 pb-10 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div aria-hidden="true" className="w-10 h-1 rounded-full bg-slate-600 mx-auto mb-2" />
            <div className="text-center">
              <div className="text-2xl mb-1" aria-hidden="true">
                {pendingWarning.diffMinutes > 0 ? "⏰" : "⚡"}
              </div>
              <div id="punch-warning-heading" className="text-lg font-extrabold text-slate-100">
                {pendingWarning.heading}
              </div>
              <div className="text-sm text-slate-400 mt-1">{pendingWarning.body}</div>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <button
                onClick={cancelPunch}
                autoFocus
                className="py-3.5 rounded-2xl text-sm font-bold bg-slate-800 text-slate-300 border border-slate-700 active:scale-[0.98] transition-[transform,colors] cursor-pointer hover:bg-slate-700"
              >
                Cancel
              </button>
              <button
                onClick={confirmPunch}
                data-testid="confirm-punch-btn"
                className="py-3.5 rounded-2xl text-sm font-bold bg-green-500/20 text-green-400 border border-green-500/30 active:scale-[0.98] transition-[transform,colors] cursor-pointer hover:bg-green-500/30"
              >
                {pendingPunchType === "clock_in" ? "Clock In Anyway" : "End Shift Anyway"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
    </AppShell>
  );
}
