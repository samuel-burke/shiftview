"use client";

import { downloadCSV } from "../../lib/csv-download";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAppData } from "@/lib/AppDataContext";
import {
  Schedule,
  PunchRecord,
  PunchType,
  AttendanceStatus,
  getAttendanceStatus,
  getTotalClockedSeconds,
  getBreakElapsedSeconds,
  fmtElapsed,
  fmtMinutes,
  getShiftType,
  SHIFT_COLORS,
} from "../../data/types";
import BottomNav from "../../components/BottomNav";
import AppShell from "../../components/AppShell";
import NotificationBell from "../../components/NotificationBell";
import UserMenu from "../../components/UserMenu";
import { createClient } from "@/lib/supabase-browser";
import { getPunchWarning, type PunchWarning } from "@/lib/punch-warning";
import { SkeletonClockBody } from "../../components/Skeleton";
import { haversineMeters } from "@/lib/haversine";
import { motion } from "framer-motion";
import { haptic } from "@/lib/haptic";
import { DEMO_EMPLOYEES, getDemoSchedulesForDate } from "../../data/demo-fixtures";

const DEMO_EMPLOYEE = DEMO_EMPLOYEES[0]; // Jordan Martinez, id 1

const listContainer = { hidden: {}, show: { transition: { staggerChildren: 0.03 } } };
const listItem = { hidden: { opacity: 0, y: 6 }, show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 500, damping: 32, mass: 0.6 } } };

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
    window.location.href = "/login";
  }

  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [punches, setPunches] = useState<PunchRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nowMinutes, setNowMinutes] = useState(getNowMinutes);
  const [elapsed, setElapsed] = useState(0);
  const [breakElapsed, setBreakElapsed] = useState(0);

  const { me: cachedMe, storeHours: weeklyHours, settings, scheduleCache, setScheduleCache, punchCache, setPunchCache, sharedLoading } = useAppData();
  const { manualPunchesEnabled, gpsRequired, geofenceEnabled, geofenceLat, geofenceLng, geofenceRadius, geofenceAddress } = settings;

  // me is critical for the account-not-linked check — fetch directly for reliability,
  // initialize from context cache if available so return visits are instant.
  const [isManager, setIsManager] = useState(() => cachedMe.isManager);
  const [employeeId, setEmployeeId] = useState<number | null>(() => cachedMe.employeeId);
  const [employeeName, setEmployeeName] = useState<string | null>(() => cachedMe.employeeName);
  const [meLoading, setMeLoading] = useState(!cachedMe.isManager && cachedMe.employeeId === null);

  useEffect(() => {
    if (isDemo) return;
    fetch(`/api/me`)
      .then(r => r.json())
      .then(({ isManager: mgr, employeeId: empId, employeeName: empName }) => {
        setIsManager(!!mgr);
        setEmployeeId(empId ?? null);
        setEmployeeName(empName ?? null);
        setMeLoading(false);
      })
      .catch(() => setMeLoading(false));
  }, [isDemo]);

  // Missed punch — open session detected from a previous day
  type MissedPunchInfo = {
    date: string;
    lastPunchType: PunchType;
    lastPunchedAt: string;
    suggestedPunchType: PunchType;
  };
  const [missedPunchInfo, setMissedPunchInfo] = useState<MissedPunchInfo | null>(null);

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

  // Break duration timer — ticks every second while on break
  useEffect(() => {
    setBreakElapsed(getBreakElapsedSeconds(punches));
    if (status === "on_break") {
      const t = setInterval(() => setBreakElapsed(getBreakElapsedSeconds(punches)), 1000);
      return () => clearInterval(t);
    }
  }, [punches, status]);

  // Live nowMinutes for shift status
  useEffect(() => {
    const t = setInterval(() => setNowMinutes(getNowMinutes()), 60000);
    return () => clearInterval(t);
  }, []);

  // employeeId from context, but we need it in loadData which is a callback
  const employeeIdRef = useRef(employeeId);
  employeeIdRef.current = employeeId;

  const loadData = useCallback(async (background = false) => {
    if (!background) setLoading(true);
    setError(null);
    try {
      if (isDemo) {
        const scheds = getDemoSchedulesForDate(todayKey);
        setSchedule(scheds.find((s) => s.employeeId === DEMO_EMPLOYEE.id) ?? null);
        setPunches([]);
        return;
      }

      const [schedRes, punchRes, missedRes] = await Promise.all([
        fetch(`/api/schedules?date=${todayKey}`),
        fetch(`/api/punches?date=${todayKey}`),
        fetch(`/api/punches/missed`),
      ]);

      const scheds: Schedule[] = await schedRes.json();
      setScheduleCache(todayKey, scheds);
      const empId = employeeIdRef.current;
      setSchedule(empId ? (scheds.find((s) => s.employeeId === empId) ?? null) : null);

      const punchData: PunchRecord[] = await punchRes.json();
      const allPunches = Array.isArray(punchData) ? punchData : [];
      setPunchCache(todayKey, allPunches);
      const myPunches = empId ? allPunches.filter((p) => p.employeeId === empId) : [];
      setPunches(myPunches);

      const missedData = await missedRes.json();
      setMissedPunchInfo(missedData.missedPunch ?? null);
    } catch {
      if (!background) setError("Failed to load data");
    } finally {
      if (!background) setLoading(false);
    }
  }, [todayKey, isDemo, setScheduleCache, setPunchCache]);

  useEffect(() => {
    if (meLoading) return; // don't load data until employee identity is known
    if (isDemo) { loadData(); return; }
    const empId = employeeIdRef.current;
    const cachedScheds = scheduleCache[todayKey];
    const cachedPunches = punchCache[todayKey];
    if (cachedScheds && cachedPunches) {
      setSchedule(empId ? (cachedScheds.find((s) => s.employeeId === empId) ?? null) : null);
      setPunches(empId ? cachedPunches.filter((p) => p.employeeId === empId) : []);
      setLoading(false);
      loadData(true);
    } else {
      loadData();
    }
  }, [todayKey, isDemo, meLoading]);

  // Supabase Realtime — reload schedule/punches when they change (settings/hours handled by context)
  useEffect(() => {
    if (isDemo) return;
    const channel = supabase
      .channel("clock-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "schedules" }, () => loadData(false))
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
    haptic();
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
      setMissedPunchInfo(null);
      await loadData(false);
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

  // Desktop-only header — mobile header is handled by AppShell's TopBar
  const clockHeader = (
    <div className="hidden [@media(min-width:900px)]:flex px-6 py-[14px] border-b border-slate-800 items-center justify-between">
      <div>
        <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">Time Clock</div>
        <div className="text-xl font-extrabold text-slate-100 leading-tight mt-0.5">{firstName}</div>
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

  const mainClass = "max-w-[480px] mx-auto px-4 pb-28 bg-bg min-h-screen [@media(min-width:900px)]:max-w-none [@media(min-width:900px)]:px-0 [@media(min-width:900px)]:pb-0";

  const appShellProps = {
    active: "clock" as const,
    isManager,
    userName: employeeName,
    isDemo,
    onSignOut: isDemo ? undefined : handleSignOut,
    onSignIn: isDemo ? () => router.push("/login") : undefined,
  };

  if (loading || meLoading) {
    return (
      <AppShell {...appShellProps}>
        <main className={mainClass}>
          <div className="[@media(min-width:900px)]:max-w-[600px] [@media(min-width:900px)]:mx-auto [@media(min-width:900px)]:px-6 [@media(min-width:900px)]:py-6">
            <SkeletonClockBody />
          </div>
          <BottomNav active="clock" />
        </main>
      </AppShell>
    );
  }

  // Employee not linked
  if (!employeeId && !isManager) {
    return (
      <AppShell {...appShellProps}>
        <main className={mainClass}>
          <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3 text-center px-4">
            <div aria-hidden="true" className="text-4xl">🔗</div>
            <div className="text-lg font-bold text-slate-100">Account not linked</div>
            <div className="text-sm text-slate-400 max-w-xs">Your account isn&apos;t linked to an employee record yet. Contact your manager to get set up.</div>
          </div>
          <BottomNav active="clock" />
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell {...appShellProps}>
    <main className={mainClass}>
      {isDemo && (
        <div className="bg-blue-500/8 border-b border-blue-500/15 px-4 py-1.5 flex items-center justify-between">
          <span className="text-[11px] text-blue-400/80 font-medium">Demo Mode · Changes are not saved</span>
          <a href="/login" className="text-[11px] font-bold text-blue-400 hover:text-blue-300 transition-colors">Sign In →</a>
        </div>
      )}
      {clockHeader}

      <div className="[@media(min-width:900px)]:max-w-[600px] [@media(min-width:900px)]:mx-auto [@media(min-width:900px)]:px-6 [@media(min-width:900px)]:py-4">
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
              {effectiveStatus === "on_break" ? (
                <>
                  <div
                    className="text-4xl font-mono font-extrabold tabular-nums"
                    style={{ color: STATUS_COLORS["on_break"] }}
                    aria-live="polite"
                    aria-label={`Current break duration: ${fmtElapsed(breakElapsed)}`}
                  >
                    {fmtElapsed(breakElapsed)}
                  </div>
                  <div className="text-xs text-slate-400 mt-1" aria-hidden="true">Current break duration</div>
                  <div className="mt-3 pt-3 border-t border-slate-800/60">
                    <div className="text-xl font-mono font-bold text-slate-500 tabular-nums">
                      {fmtElapsed(elapsed)}
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5" aria-hidden="true">Total time worked today</div>
                  </div>
                </>
              ) : (
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

        {/* Missed punch banner — shown when an open session from a previous day is detected */}
        {missedPunchInfo && (
          <div
            role="alert"
            className="px-4 py-3.5 bg-amber-500/10 border border-amber-500/25 rounded-2xl space-y-2"
          >
            <div className="flex items-start gap-2.5">
              <span aria-hidden="true" className="text-amber-400 mt-px shrink-0">⚠</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-amber-300">Open shift from {missedPunchInfo.date}</div>
                <div className="text-xs text-amber-400/80 mt-0.5">
                  {missedPunchInfo.lastPunchType === "break_start"
                    ? <>Your last punch was a <span className="font-semibold text-amber-300">break start</span> on {missedPunchInfo.date} at {new Date(missedPunchInfo.lastPunchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Add your missing break end and clock-out before clocking in today.</>
                    : <>Your last punch was a <span className="font-semibold text-amber-300">{missedPunchInfo.lastPunchType === "clock_in" ? "clock in" : "break end"}</span> on {missedPunchInfo.date} at {new Date(missedPunchInfo.lastPunchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Add your missing clock-out before clocking in today.</>
                  }
                </div>
              </div>
            </div>
            {!showCorrection && (
              <button
                onClick={() => {
                  setCorrectionDate(missedPunchInfo.date);
                  setCorrectionType(missedPunchInfo.suggestedPunchType);
                  setShowCorrection(true);
                }}
                className="w-full py-3 rounded-xl text-xs font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 cursor-pointer hover:bg-amber-500/30 transition-colors"
              >
                {missedPunchInfo.suggestedPunchType === "break_end" ? "Add Missing Break End" : "Add Missing Clock-Out"}
              </button>
            )}
          </div>
        )}

        {/* Action buttons */}
        {actionError && (
          <div role="alert" className="px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 text-center">
            {actionError}
          </div>
        )}

        <div className="grid gap-3">
          {effectiveStatus === "not_clocked_in" && (
            <motion.button
              onClick={() => handlePunchClick("clock_in")}
              disabled={actionPending}
              aria-busy={actionPending}
              whileHover={{ scale: 1.02, boxShadow: "0 8px 32px rgba(34,197,94,0.35)" }}
              whileTap={{ scale: 0.96 }}
              transition={{ type: "spring", stiffness: 400, damping: 22 }}
              className="w-full py-4 rounded-2xl text-lg font-extrabold bg-green-500 text-white shadow-lg shadow-green-500/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer hover:bg-green-600"
            >
              {actionPending ? "…" : "Clock In"}
            </motion.button>
          )}

          {effectiveStatus === "clocked_in" && (
            <div className="grid grid-cols-2 gap-3">
              <motion.button
                onClick={() => submitPunch("break_start")}
                disabled={actionPending}
                aria-busy={actionPending}
                whileHover={{ scale: 1.02, boxShadow: "0 4px 20px rgba(245,158,11,0.2)" }}
                whileTap={{ scale: 0.96 }}
                transition={{ type: "spring", stiffness: 400, damping: 22 }}
                className="py-4 rounded-2xl text-base font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer hover:bg-amber-500/30"
              >
                {actionPending ? "…" : "Start Break"}
              </motion.button>
              <motion.button
                onClick={() => handlePunchClick("clock_out")}
                disabled={actionPending}
                aria-busy={actionPending}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.96 }}
                transition={{ type: "spring", stiffness: 400, damping: 22 }}
                className="py-4 rounded-2xl text-base font-bold bg-slate-700 text-slate-200 border border-slate-600 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer hover:bg-slate-600"
              >
                {actionPending ? "…" : "End Shift"}
              </motion.button>
            </div>
          )}

          {effectiveStatus === "on_break" && (
            <motion.button
              onClick={() => submitPunch("break_end")}
              disabled={actionPending}
              aria-busy={actionPending}
              whileHover={{ scale: 1.02, boxShadow: "0 8px 32px rgba(245,158,11,0.35)" }}
              whileTap={{ scale: 0.96 }}
              transition={{ type: "spring", stiffness: 400, damping: 22 }}
              className="w-full py-4 rounded-2xl text-lg font-extrabold bg-amber-500 text-white shadow-lg shadow-amber-500/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer hover:bg-amber-600"
            >
              {actionPending ? "…" : "End Break"}
            </motion.button>
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

        {/* Punch correction form — hidden when setting is disabled */}
        {manualPunchesEnabled && <div className="bg-card rounded-2xl border border-slate-800/60" style={missedPunchInfo ? { borderColor: "rgba(245,158,11,0.3)" } : {}}>
          <button
            onClick={() => setShowCorrection((v) => !v)}
            aria-expanded={showCorrection}
            aria-controls="correction-form"
            className="w-full flex items-center justify-between px-4 py-3.5 cursor-pointer hover:bg-slate-800/50 transition-colors rounded-2xl"
          >
            <span className="text-sm font-semibold text-slate-300">
              {missedPunchInfo
              ? missedPunchInfo.suggestedPunchType === "break_end"
                ? "Add Missing Break End"
                : "Add Missing Clock-Out"
              : "Report Missed Punch"}
            </span>
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
                className="w-full py-3 rounded-xl text-sm font-bold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer hover:bg-indigo-500/30 transition-colors"
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
                className="block w-full py-3 rounded-xl text-sm font-bold text-center bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 cursor-pointer hover:bg-indigo-500/30 transition-colors"
              >
                Download CSV
              </button>
            </div>
          )}
        </div>
      </div>
      </div>

      <BottomNav active="clock" />

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
