"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
import NotificationBell from "../../components/NotificationBell";

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

  const [actionPending, setActionPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [gpsStatus, setGpsStatus] = useState<"idle" | "acquiring" | "ok" | "denied">("idle");

  const todayKey = toDateKey(today);
  const storeHours = weeklyHours[today.getDay()];

  const status = getAttendanceStatus(punches);

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
      const [meRes, schedRes, punchRes, hoursRes] = await Promise.all([
        fetch(`/api/me${isDemo ? "?demo=true" : ""}`),
        fetch(`/api/schedules?date=${todayKey}`),
        fetch(`/api/punches?date=${todayKey}`),
        fetch("/api/store-hours"),
      ]);

      const me = await meRes.json();
      setIsManager(!!me.isManager);
      setEmployeeName(me.employeeName ?? null);
      setEmployeeId(me.employeeId ?? null);

      const scheds: Schedule[] = await schedRes.json();
      const emp = me.employeeId;
      setSchedule(emp ? (scheds.find((s) => s.employeeId === emp) ?? null) : null);

      const punchData: PunchRecord[] = await punchRes.json();
      setPunches(Array.isArray(punchData) ? punchData : []);

      const hours = await hoursRes.json();
      setWeeklyHours((prev) => ({ ...prev, ...hours }));
    } catch {
      setError("Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [todayKey, isDemo]);

  useEffect(() => { loadData(); }, [loadData]);

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

  async function submitPunch(punchType: PunchType) {
    if (actionPending) return;
    setActionPending(true);
    setActionError(null);

    let lat: number | null = null;
    let lng: number | null = null;

    if (punchType === "clock_in") {
      const gps = await getGps();
      if (gps) { lat = gps.lat; lng = gps.lng; }
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

  if (loading) {
    return (
      <main className="max-w-[480px] mx-auto px-4 pb-28 bg-bg min-h-screen">
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="spinner" />
        </div>
        <BottomNav active="clock" />
      </main>
    );
  }

  // Employee not linked
  if (!employeeId && !isManager) {
    return (
      <main className="max-w-[480px] mx-auto px-4 pb-28 bg-bg min-h-screen">
        <div
          className="px-0 pb-3 flex items-center justify-between border-b border-slate-800 bg-bg"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}
        >
          <span className="text-2xl font-extrabold text-slate-100 tracking-tight">
            Time<span className="bg-gradient-to-r from-blue-500 to-violet-500 bg-clip-text text-transparent">Clock</span>
          </span>
        </div>
        <div className="flex flex-col items-center justify-center min-h-[50vh] gap-3 text-center">
          <div className="text-4xl">🔗</div>
          <div className="text-lg font-bold text-slate-100">Account not linked</div>
          <div className="text-sm text-slate-400 max-w-xs">Your account isn&apos;t linked to an employee record yet. Contact your manager to get set up.</div>
        </div>
        <BottomNav active="clock" />
      </main>
    );
  }

  return (
    <main className="max-w-[480px] mx-auto px-4 pb-28 bg-bg min-h-screen">
      {/* Header */}
      <div
        className="px-0 pb-3 flex items-center justify-between border-b border-slate-800 bg-bg"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}
      >
        <div>
          <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">Time Clock</div>
          <div className="text-[28px] font-extrabold text-slate-100 leading-tight mt-0.5">{firstName}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-slate-400">
            {today.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
          </span>
          {!isDemo && <NotificationBell />}
        </div>
      </div>

      {error && (
        <div className="mt-3 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 text-center">
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
              background: `${STATUS_COLORS[status]}22`,
              color: STATUS_COLORS[status],
              border: `1px solid ${STATUS_COLORS[status]}44`,
            }}
          >
            <span
              className="size-2 rounded-full"
              style={{
                background: STATUS_COLORS[status],
                boxShadow: status === "clocked_in" ? `0 0 6px ${STATUS_COLORS[status]}` : "none",
              }}
            />
            {STATUS_LABELS[status]}
          </div>

          {(status === "clocked_in" || status === "on_break" || status === "clocked_out") && (
            <>
              <div className="text-4xl font-mono font-extrabold text-slate-100 tabular-nums">
                {fmtElapsed(elapsed)}
              </div>
              <div className="text-xs text-slate-400 mt-1">Total time worked today</div>
            </>
          )}

          {gpsStatus === "acquiring" && (
            <div className="text-xs text-slate-400 mt-2">Acquiring GPS…</div>
          )}
          {gpsStatus === "ok" && status === "clocked_in" && (
            <div className="text-xs text-green-500 mt-2">GPS location captured</div>
          )}
          {gpsStatus === "denied" && (
            <div className="text-xs text-amber-400 mt-2">GPS unavailable — punched without location</div>
          )}
        </div>

        {/* Action buttons */}
        {actionError && (
          <div className="px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 text-center">
            {actionError}
          </div>
        )}

        <div className="grid gap-3">
          {status === "not_clocked_in" && (
            <button
              onClick={() => submitPunch("clock_in")}
              disabled={actionPending}
              className="w-full py-4 rounded-2xl text-lg font-extrabold bg-green-500 text-white shadow-lg shadow-green-500/20 active:scale-[0.98] transition-transform disabled:opacity-50 cursor-pointer"
            >
              {actionPending ? "…" : "Clock In"}
            </button>
          )}

          {status === "clocked_in" && (
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => submitPunch("break_start")}
                disabled={actionPending}
                className="py-4 rounded-2xl text-base font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 active:scale-[0.98] transition-transform disabled:opacity-50 cursor-pointer"
              >
                {actionPending ? "…" : "Start Break"}
              </button>
              <button
                onClick={() => submitPunch("clock_out")}
                disabled={actionPending}
                className="py-4 rounded-2xl text-base font-bold bg-slate-700 text-slate-200 border border-slate-600 active:scale-[0.98] transition-transform disabled:opacity-50 cursor-pointer"
              >
                {actionPending ? "…" : "End Shift"}
              </button>
            </div>
          )}

          {status === "on_break" && (
            <button
              onClick={() => submitPunch("break_end")}
              disabled={actionPending}
              className="w-full py-4 rounded-2xl text-lg font-extrabold bg-amber-500 text-white shadow-lg shadow-amber-500/20 active:scale-[0.98] transition-transform disabled:opacity-50 cursor-pointer"
            >
              {actionPending ? "…" : "End Break"}
            </button>
          )}

          {status === "clocked_out" && (
            <div className="text-center py-3 text-sm text-slate-400">
              Shift complete — see you next time!
            </div>
          )}
        </div>

        {/* Punch history */}
        {punches.length > 0 && (
          <div>
            <div className="text-xs font-bold text-slate-400 uppercase tracking-[0.08em] mb-2">Today&apos;s Punches</div>
            <div className="bg-card rounded-2xl border border-slate-800/60 divide-y divide-slate-800">
              {[...punches]
                .sort((a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime())
                .map((p) => (
                  <div key={p.id} className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <span
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
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Missed punch correction */}
        <div className="bg-card rounded-2xl border border-slate-800/60">
          <button
            onClick={() => setShowCorrection((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3.5 cursor-pointer"
          >
            <span className="text-sm font-semibold text-slate-300">Report Missed Punch</span>
            <span className="text-slate-500 text-lg">{showCorrection ? "▴" : "▾"}</span>
          </button>

          {showCorrection && (
            <div className="px-4 pb-4 space-y-3 border-t border-slate-800">
              <div className="grid grid-cols-2 gap-3 pt-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Punch Type</label>
                  <select
                    value={correctionType}
                    onChange={(e) => setCorrectionType(e.target.value as PunchType)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                  >
                    <option value="clock_in">Clock In</option>
                    <option value="clock_out">Clock Out</option>
                    <option value="break_start">Break Start</option>
                    <option value="break_end">Break End</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">Date</label>
                  <input
                    type="date"
                    value={correctionDate}
                    onChange={(e) => setCorrectionDate(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Time</label>
                <input
                  type="time"
                  value={correctionTime}
                  onChange={(e) => setCorrectionTime(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Reason <span className="text-red-400">*</span></label>
                <textarea
                  value={correctionNote}
                  onChange={(e) => setCorrectionNote(e.target.value)}
                  placeholder="Why is this punch being added manually?"
                  rows={2}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 resize-none"
                />
              </div>
              {correctionError && (
                <div className="text-xs text-red-400">{correctionError}</div>
              )}
              <button
                onClick={submitCorrection}
                disabled={correctionSaving || !correctionNote.trim()}
                className="w-full py-2.5 rounded-xl text-sm font-bold bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 disabled:opacity-50 cursor-pointer"
              >
                {correctionSaving ? "Saving…" : "Submit Correction"}
              </button>
            </div>
          )}
        </div>

        {/* Timesheet export */}
        <div className="bg-card rounded-2xl border border-slate-800/60">
          <button
            onClick={() => setShowExport((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3.5 cursor-pointer"
          >
            <span className="text-sm font-semibold text-slate-300">Export Timesheet</span>
            <span className="text-slate-500 text-lg">{showExport ? "▴" : "▾"}</span>
          </button>

          {showExport && (
            <div className="px-4 pb-4 border-t border-slate-800 pt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-400 block mb-1">From</label>
                  <input
                    type="date"
                    value={exportFrom}
                    onChange={(e) => setExportFrom(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-400 block mb-1">To</label>
                  <input
                    type="date"
                    value={exportTo}
                    onChange={(e) => setExportTo(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100"
                  />
                </div>
              </div>
              <a
                href={`/api/punches/export?from=${exportFrom}&to=${exportTo}`}
                download
                className="block w-full py-2.5 rounded-xl text-sm font-bold text-center bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 cursor-pointer"
              >
                Download CSV
              </a>
            </div>
          )}
        </div>
      </div>

      <BottomNav active="clock" />
    </main>
  );
}
