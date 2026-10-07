"use client";
import { downloadCSV } from "../lib/csv-download";
import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useMemo, useState, useEffect, useRef } from "react";
import { motion, useSpring, useTransform, AnimatePresence } from "framer-motion";
import {
  Employee,
  Schedule,
  PunchRecord,
  AttendanceStatus,
  AvailabilityRecord,
  Callout,
  isHere,
  CoverageStatus,
  getAttendanceStatus,
  fmtMinutes,
  SHIFT_COLORS,
  CALLOUT_COLOR,
} from "../data/types";
import { useAppData } from "../lib/AppDataContext";
import CoverageHeader from "../components/CoverageHeader";
import TeamSection from "../components/TeamSection";
import EmployeeDrawer from "../components/EmployeeDrawer";
import TimeCardDrawer from "../components/TimeCardDrawer";
import { SkeletonTeamSection, SkeletonTimeline } from "../components/Skeleton";
import BottomNav from "../components/BottomNav";
import AppShell from "../components/AppShell";
import { createClient } from "@/lib/supabase-browser";
import { createApiFetch } from "@/lib/api-fetch";
import { CoverageBlock, CoverageProfile, curveForDate, liveCoverageStatus, targetAt } from "@/lib/coverage";
import { SunriseIcon, SunIcon, MoonIcon } from "../components/ShiftIcons";
import {
  addDaysToKey,
  dateFromKey,
  dateKeyInTz,
  dayOfWeekForKey,
  eachDateKey,
  localDateKey,
  nowMinutesInTz,
  todayKeyInTz,
  weekStartForKey,
} from "@/lib/dates";
import { useStoreTodayKey } from "@/hooks/useStoreTodayKey";
import { isOvernight, shiftTouchesDay, shiftWindowOn } from "@/lib/shift-times";

// Code-split the recharts-backed timeline off the dashboard's initial bundle.
// It only renders once data has loaded (gated behind SkeletonTimeline below),
// so deferring the chart library keeps the home route's JS payload small.
const CoverageTimeline = dynamic(() => import("../components/CoverageTimeline"), {
  ssr: false,
  loading: () => <SkeletonTimeline />,
});

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Cap the team export so it stays a manageable grid and a bounded number of
// per-day schedule fetches.
const MAX_EXPORT_DAYS = 62;

function AnimatedStatCard({
  index,
  value,
  label,
  color,
  loading,
  pulse = false,
}: {
  index: number;
  value: number;
  label: string;
  color: string;
  loading: boolean;
  pulse?: boolean;
}) {
  const spring = useSpring(0, { stiffness: 80, damping: 20, restDelta: 0.5 });
  const display = useTransform(spring, (v) => Math.round(v).toString());

  useEffect(() => {
    if (!loading) spring.set(value);
  }, [value, loading, spring]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, delay: index * 0.07, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="relative flex-1 bg-card rounded-xl px-2 py-3 text-center overflow-hidden"
      style={{
        border: `1px solid ${color}33`,
        boxShadow: pulse ? `0 0 16px ${color}18` : undefined,
      }}
    >
      {/* Subtle radial glow bg */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{ background: `radial-gradient(ellipse at 50% 0%, ${color}09 0%, transparent 70%)` }}
      />

      {loading ? (
        <div className="flex justify-center mb-1.5">
          <div className="skeleton h-7 w-8 rounded-[6px]" />
        </div>
      ) : (
        <div className="relative flex items-center justify-center gap-1.5">
          {pulse && value > 0 && (
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ background: color }} />
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: color }} />
            </span>
          )}
          <motion.span
            className="text-[28px] font-extrabold leading-none tabular-nums"
            style={{ color }}
          >
            {display}
          </motion.span>
        </div>
      )}
      <div className="text-[11px] text-slate-400 mt-1 font-medium relative">{label}</div>
    </motion.div>
  );
}

export default function Page() {
  const router = useRouter();
  const {
    me, storeHours: weeklyHoursCtx, settings, sharedLoading,
    employees: cachedEmployees, cacheEmployees,
    scheduleCache, setScheduleCache,
    punchCache, setPunchCache,
  } = useAppData();
  const { coverageAlertsEnabled, timezone } = settings;

  // The viewed day is a store-local calendar date. null means "today", which
  // tracks the store's timezone (and rolls over at the store's midnight) no
  // matter what timezone this browser is in.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const todayKey = useStoreTodayKey(timezone);
  const dateKey = selectedKey ?? todayKey;
  const today = useMemo(() => dateFromKey(todayKey), [todayKey]);
  const date = useMemo(() => dateFromKey(dateKey), [dateKey]);
  const [selected, setSelected] = useState<{
    emp: Employee;
    sch: Schedule | null;
  } | null>(null);
  const [availabilityRecords, setAvailabilityRecords] = useState<AvailabilityRecord[]>([]);
  // The store's current wall-clock minute, derived each render; a ticker below
  // re-renders once a minute so it stays live.
  const [, setMinuteTick] = useState(0);
  const nowMinutes = nowMinutesInTz(timezone);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  // The previous day's shifts: overnight ones (and closers still clocked in)
  // run into the viewed day.
  const [prevSchedules, setPrevSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportFrom, setExportFrom] = useState(() => weekStartForKey(todayKey, 1));
  const [exportTo, setExportTo] = useState(() => addDaysToKey(weekStartForKey(todayKey, 1), 6));
  const [showExport, setShowExport] = useState(false);
  const [punchRecords, setPunchRecords] = useState<PunchRecord[]>([]);
  const [punchesLoaded, setPunchesLoaded] = useState(false);
  const [callouts, setCallouts] = useState<Callout[]>([]);
  const [timeCardEmp, setTimeCardEmp] = useState<Employee | null>(null);
  const supabase = createClient();
  const apiFetch = createApiFetch(() => router.push("/login"));

  // Initialize from context cache for instant render on remount; direct fetch always runs for reliability
  const [employees, setEmployees] = useState<Employee[]>(() => cachedEmployees);
  const { isManager, employeeName: userName, isDemo } = me;
  const weeklyHours = weeklyHoursCtx;
  const [dayCurve, setDayCurve] = useState<CoverageBlock[]>([]);

  // Mutable ref so subscription callbacks always see the latest viewed date
  const dateKeyRef = useRef(dateKey);
  dateKeyRef.current = dateKey;

  async function handleExportCSV() {
    if (exportFrom > exportTo) {
      setError("Export start date must not be after the end date.");
      return;
    }
    const capturedDates = eachDateKey(exportFrom, exportTo);
    if (capturedDates.length > MAX_EXPORT_DAYS) {
      setError(`Export range is too large — pick ${MAX_EXPORT_DAYS} days or fewer.`);
      return;
    }
    setExportLoading(true);

    const results = await Promise.allSettled(
      capturedDates.map(d =>
        fetch(`/api/schedules?date=${d}`).then(r => r.json())
      )
    );

    if (results.some(r => r.status === "rejected")) {
      setError("Failed to load schedule data for export. Please try again.");
      setExportLoading(false);
      return;
    }

    const allSchedules = results.flatMap(r => r.status === "fulfilled" ? r.value as Schedule[] : []);

    // Build header row: Employee, Mon DATE, Tue DATE, ...
    const headerCols = capturedDates.map((d) => `${WEEKDAY_LABELS[new Date(d + "T12:00:00Z").getUTCDay()]} ${d}`);
    const header = ["Employee", ...headerCols].join(",");

    // Build one row per employee
    const rows = employees.map(emp => {
      const cols = capturedDates.map(d => {
        const sch = allSchedules.find(s => s.employeeId === emp.id && s.date.slice(0, 10) === d);
        if (!sch) return "";
        return `${fmtMinutes(sch.startMinutes)} – ${fmtMinutes(sch.endMinutes)}`;
      });
      const safeName = emp.name.includes(",") ? `"${emp.name}"` : emp.name;
      return [safeName, ...cols].join(",");
    });

    const csvContent = [header, ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv" });
    downloadCSV(blob, `schedule_${exportFrom}_to_${exportTo}.csv`);

    setExportLoading(false);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  function reloadPrevSchedules(dk: string) {
    const prev = addDaysToKey(dk, -1);
    return apiFetch(`/api/schedules?date=${prev}`)
      .then((r) => r.json())
      .then((data) => {
        if (!Array.isArray(data) || dateKeyRef.current !== dk) return;
        setPrevSchedules(data);
        setScheduleCache(prev, data);
      })
      .catch(() => {});
  }

  async function handleSaveShift(scheduleId: number, startMinutes: number, endMinutes: number, override = false) {
    const res = await apiFetch("/api/schedules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: scheduleId, startMinutes, endMinutes, override }),
    });
    if (!res.ok) {
      const body = await res.json();
      if (body.conflict) {
        const err = Object.assign(new Error(body.message ?? "Conflict"), {
          conflict: body.conflict,
          window: body.window ?? null,
        });
        throw err;
      }
      throw new Error(body.error ?? "Failed to save shift");
    }
    reloadPrevSchedules(dateKey); // the edited shift may be last night's overnight shift
    const data = await apiFetch(`/api/schedules?date=${dateKey}`).then((r) => r.json());
    if (Array.isArray(data)) {
      setSchedules(data);
      setScheduleCache(dateKey, data);
    }
  }

  async function handleCreateShift(employeeId: number, startMinutes: number, endMinutes: number, override = false) {
    const res = await apiFetch("/api/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId, date: dateKey, startMinutes, endMinutes, override }),
    });
    if (!res.ok) {
      const body = await res.json();
      if (body.conflict) {
        const err = Object.assign(new Error(body.message ?? "Conflict"), {
          conflict: body.conflict,
          window: body.window ?? null,
        });
        throw err;
      }
      throw new Error(body.error ?? "Failed to add shift");
    }
    const data2 = await apiFetch(`/api/schedules?date=${dateKey}`).then((r) => r.json());
    if (Array.isArray(data2)) {
      setSchedules(data2);
      setScheduleCache(dateKey, data2);
    }
  }

  async function handleResendInvite(email: string) {
    const res = await apiFetch("/api/invites", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    if (!res.ok) {
      const { error } = await res.json();
      throw new Error(error ?? "Failed to resend invite");
    }
  }

  async function handleMarkOff(scheduleId: number) {
    const res = await apiFetch("/api/schedules", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: scheduleId }),
    });
    if (!res.ok) {
      const { error } = await res.json();
      throw new Error(error ?? "Failed to mark as off");
    }
    setSchedules((prev) => prev.filter((s) => s.id !== scheduleId));
  }
  // Redirect to /login when Supabase session expires
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") window.location.href = "/login";
    });
    return () => subscription.unsubscribe();
  }, []);

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setMinuteTick((n) => n + 1), 60000);
    return () => clearInterval(t);
  }, []);

  // Supabase Realtime — live punch updates while viewing today (manager only)
  useEffect(() => {
    const todayKey = todayKeyInTz(timezone);
    const viewingToday = dateKey === todayKey;
    if (!viewingToday || !isManager) return;

    function rowToPunch(p: Record<string, unknown>): PunchRecord {
      return {
        id:         p.id          as number,
        employeeId: p.employee_id as number,
        scheduleId: p.schedule_id as number | null,
        punchType:  p.punch_type  as PunchRecord["punchType"],
        punchedAt:  p.punched_at  as string,
        lat:        p.lat         as number | null,
        lng:        p.lng         as number | null,
        isManual:   p.is_manual   as boolean,
        note:       p.note        as string | null,
      };
    }

    const channel = supabase
      .channel("punch-records-live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "punch_records" },
        (payload) => {
          const p = payload.new as Record<string, unknown>;
          const punchDate = dateKeyInTz(p.punched_at as string, timezone);
          if (punchDate !== todayKey) return;
          setPunchRecords((prev) => [...prev, rowToPunch(p)]);
          setPunchesLoaded(true);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "punch_records" },
        (payload) => {
          const p = payload.new as Record<string, unknown>;
          const punch = rowToPunch(p);
          setPunchRecords((prev) => prev.map((r) => r.id === punch.id ? punch : r));
        }
      )
      .subscribe();

    // 5-minute background poll as a fallback in case the Realtime connection drops
    const t = setInterval(() => {
      apiFetch(`/api/punches?date=${dateKey}&carried=1`)
        .then((r) => r.json())
        .then((data) => { setPunchRecords(Array.isArray(data) ? data : []); })
        .catch(() => {});
    }, 300000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(t);
    };
  }, [isManager, dateKey, timezone]);

  // Supabase Realtime — live updates for schedules, employees, time-off, store hours, settings
  useEffect(() => {
    function refetchSchedules() {
      const dk = dateKeyRef.current;
      apiFetch(`/api/schedules?date=${dk}`)
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) { setSchedules(data); setScheduleCache(dk, data); }
        })
        .catch(() => {});
      reloadPrevSchedules(dk);
    }

    function refetchEmployees() {
      apiFetch("/api/employees")
        .then(r => r.json())
        .then((data: Employee[]) => { if (Array.isArray(data)) { setEmployees(data); cacheEmployees(data); } })
        .catch(() => {});
    }

    function refetchCallouts() {
      const dk = dateKeyRef.current;
      apiFetch(`/api/callouts?date=${dk}`)
        .then((r) => r.json())
        .then((d) => { if (Array.isArray(d?.callouts)) setCallouts(d.callouts); })
        .catch(() => {});
    }

    let hiddenAt = 0;
    function onVisibility() {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
      } else if (Date.now() - hiddenAt > 5_000) {
        refetchSchedules();
        refetchEmployees();
        refetchCallouts();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);

    const channel = supabase
      .channel("main-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "schedules" }, refetchSchedules)
      .on("postgres_changes", { event: "*", schema: "public", table: "employees" }, refetchEmployees)
      .on("postgres_changes", { event: "*", schema: "public", table: "callouts" }, refetchCallouts)
      .subscribe();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      supabase.removeChannel(channel);
    };
  }, []);


  // Fetch employees directly — reliable primary source.
  // If context already has employees (return visit), start with those and refresh in background.
  useEffect(() => {
    const controller = new AbortController();
    apiFetch("/api/employees", { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then((data: Employee[]) => {
        if (Array.isArray(data)) { setEmployees(data); cacheEmployees(data); }
      })
      .catch(err => { if (err?.name !== "AbortError") console.error("[pageClient] /api/employees failed", err); });
    return () => controller.abort();
  }, []);

  // Fetch schedules (and punch records for today) whenever date changes.
  // If the cache already has data for this date, apply it immediately so the
  // page renders without a loading skeleton, then refresh in the background.
  useEffect(() => {
    const isViewingToday = dateKey === todayKeyInTz(timezone);
    setError(null);

    const cachedSchedules = scheduleCache[dateKey];
    setPrevSchedules(scheduleCache[addDaysToKey(dateKey, -1)] ?? []);
    const cachedPunches = isViewingToday ? punchCache[dateKey] : undefined;

    if (cachedSchedules) {
      // Instant render from cache
      setSchedules(cachedSchedules);
      setLoading(false);
      if (isViewingToday) {
        if (cachedPunches) { setPunchRecords(cachedPunches); setPunchesLoaded(true); }
        else { setPunchesLoaded(false); }
      } else {
        setPunchRecords([]); setPunchesLoaded(false);
      }
    } else {
      setLoading(true);
      setPunchesLoaded(false);
    }

    // Always fetch fresh data (background refresh if cache hit, primary fetch if not)
    const fetches: Promise<void>[] = [
      apiFetch(`/api/schedules?date=${dateKey}`)
        .then((r) => r.json())
        .then((data) => {
          // Non-array means an error payload (e.g. 403 after a demo reset
          // orphaned the session) — keep the previous state instead of
          // crashing downstream .filter() calls.
          if (!Array.isArray(data)) throw new Error("schedules fetch failed");
          setSchedules(data);
          setScheduleCache(dateKey, data);
        }),
      reloadPrevSchedules(dateKey),
    ];
    if (isViewingToday) {
      fetches.push(
        apiFetch(`/api/punches?date=${dateKey}&carried=1`)
          .then((r) => r.json())
          .then((data) => {
            const punches = Array.isArray(data) ? data : [];
            setPunchRecords(punches);
            setPunchCache(dateKey, punches);
            setPunchesLoaded(true);
          })
          .catch(() => { setPunchRecords([]); setPunchesLoaded(true); })
      );
    } else {
      setPunchRecords([]);
      setPunchesLoaded(false);
    }
    Promise.all(fetches)
      .then(() => setLoading(false))
      .catch(() => {
        if (!cachedSchedules) { setError("Failed to load schedules"); setLoading(false); }
      });
  }, [dateKey, timezone]);

  // Target coverage curve for the viewed date (override → day-of-week default)
  useEffect(() => {
    const dk = dateKey;
    let cancelled = false;
    Promise.all([
      apiFetch("/api/coverage-profiles").then((r) => r.json()),
      apiFetch(`/api/coverage-assignments?from=${dk}&to=${dk}`).then((r) => r.json()),
    ])
      .then(([profiles, assignments]) => {
        if (cancelled) return;
        setDayCurve(curveForDate(
          dk,
          assignments?.overrides ?? {},
          assignments?.defaults ?? {},
          Array.isArray(profiles) ? (profiles as CoverageProfile[]) : []
        ));
      })
      .catch(() => { if (!cancelled) setDayCurve([]); });
    return () => { cancelled = true; };
  }, [dateKey, timezone]);

  // Call-outs for the viewed date — drives the "Called Out" team section.
  useEffect(() => {
    const dk = dateKey;
    let cancelled = false;
    apiFetch(`/api/callouts?date=${dk}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setCallouts(Array.isArray(d?.callouts) ? d.callouts : []); })
      .catch(() => { if (!cancelled) setCallouts([]); });
    return () => { cancelled = true; };
  }, [dateKey, timezone]);

  const isToday = dateKey === todayKey;

  // The viewed day's shifts, plus the previous day's that run into it: an
  // overnight shift, or a shift whose employee is still clocked in from it.
  const daySchedules = useMemo(() => {
    const prevKey = addDaysToKey(dateKey, -1);
    const carriedIds = new Set(
      isToday ? punchRecords.filter((p) => dateKeyInTz(p.punchedAt, timezone) === prevKey).map((p) => p.employeeId) : [],
    );
    const todays = schedules.filter((s) => s.date.slice(0, 10) === dateKey);
    const spill = prevSchedules.filter((s) =>
      s.date.slice(0, 10) === prevKey &&
      (isOvernight(s) || carriedIds.has(s.employeeId)) &&
      // a carried-over closer whose shift has already ended still shows, as clocked in
      (shiftTouchesDay(s, dateKey) || carriedIds.has(s.employeeId)));
    return [...spill, ...todays];
  }, [schedules, prevSchedules, dateKey, isToday, punchRecords, timezone]);
  const scheduled = daySchedules;

  // Build a map from employeeId → AttendanceStatus using real punch records.
  // Covers both scheduled employees and unscheduled walk-ins.
  // Only populated once punch data has loaded so we don't flash "Not Here Yet"
  // before the fetch completes.
  const attendanceMap = useMemo((): Record<number, AttendanceStatus> => {
    if (!punchesLoaded) return {};
    // Group punches by employee in a single pass so we don't re-scan the full
    // punch list once per employee (previously O(scheduled × punches + punches²)).
    const punchesByEmployee = new Map<number, PunchRecord[]>();
    for (const p of punchRecords) {
      const list = punchesByEmployee.get(p.employeeId);
      if (list) list.push(p);
      else punchesByEmployee.set(p.employeeId, [p]);
    }
    const map: Record<number, AttendanceStatus> = {};
    for (const sch of scheduled) {
      if (sch.employeeId in map) continue;
      map[sch.employeeId] = getAttendanceStatus(punchesByEmployee.get(sch.employeeId) ?? []);
    }
    // Also cover unscheduled employees who have punched in today
    for (const [employeeId, empPunches] of punchesByEmployee) {
      if (!(employeeId in map)) {
        map[employeeId] = getAttendanceStatus(empPunches);
      }
    }
    return map;
  }, [punchRecords, scheduled, punchesLoaded]);

  // Synthetic Schedule stubs for unscheduled employees who have punched in today.
  // startMinutes = -1 signals ShiftCard to render them as "Walk-in" without shift times.
  const walkInSchedules = useMemo((): Schedule[] => {
    if (!isToday || !punchesLoaded) return [];
    const scheduledIds = new Set(daySchedules.map((s) => s.employeeId));
    const seen = new Set<number>();
    const result: Schedule[] = [];
    for (const p of punchRecords) {
      if (scheduledIds.has(p.employeeId) || seen.has(p.employeeId)) continue;
      seen.add(p.employeeId);
      result.push({ id: -(p.employeeId), employeeId: p.employeeId, date: dateKey, startMinutes: -1, endMinutes: -1 });
    }
    return result;
  }, [isToday, punchesLoaded, punchRecords, daySchedules, dateKey]);

  // Employees who've called out for the viewed date. They're pulled out of the
  // scheduled/off groupings below and shown in their own "Called Out" section.
  const calloutIds = useMemo(
    () => new Set(callouts.map((c) => c.employeeId)),
    [callouts],
  );

  const calledOutEmployees = useMemo(() => {
    const empMap = new Map(employees.map((e) => [e.id, e]));
    return callouts
      .map((c) => empMap.get(c.employeeId))
      .filter((e): e is Employee => !!e);
  }, [callouts, employees]);

  const off = useMemo(() => {
    const walkInIds = new Set(walkInSchedules.map((s) => s.employeeId));
    return employees.filter(
      (emp) =>
        !daySchedules.some((s) => s.employeeId === emp.id) &&
        !walkInIds.has(emp.id) &&
        !calloutIds.has(emp.id),
    );
  }, [employees, daySchedules, walkInSchedules, calloutIds]);

  const sortedScheduled = useMemo(
    () => [...scheduled]
      .sort((a, b) => shiftWindowOn(a, dateKey).start - shiftWindowOn(b, dateKey).start)
      .filter((s) => !(s.date.slice(0, 10) === dateKey && calloutIds.has(s.employeeId))),
    [scheduled, calloutIds, dateKey],
  );

  // Split sortedScheduled (plus walk-ins) into the three attendance-based sub-groups.
  // When attendanceMap is empty (!punchesLoaded), all shifts fall into scheduledRemaining.
  const hereNowSchedules = useMemo(
    () => [
      ...sortedScheduled.filter((s) => attendanceMap[s.employeeId] === "clocked_in"),
      ...walkInSchedules.filter((s) => attendanceMap[s.employeeId] === "clocked_in"),
    ],
    [sortedScheduled, walkInSchedules, attendanceMap],
  );
  const onBreakSchedules = useMemo(
    () => [
      ...sortedScheduled.filter((s) => attendanceMap[s.employeeId] === "on_break"),
      ...walkInSchedules.filter((s) => attendanceMap[s.employeeId] === "on_break"),
    ],
    [sortedScheduled, walkInSchedules, attendanceMap],
  );
  const scheduledRemaining = useMemo(
    () => [
      ...sortedScheduled.filter((s) => {
        const st = attendanceMap[s.employeeId];
        return !st || st === "not_clocked_in" || st === "clocked_out";
      }),
      ...walkInSchedules.filter((s) => attendanceMap[s.employeeId] === "clocked_out"),
    ],
    [sortedScheduled, walkInSchedules, attendanceMap],
  );

  // When punch data is loaded for today, count ALL clocked-in employees from punch
  // records (including unscheduled arrivals and pre-shift clock-ins). Before punch
  // data arrives or on non-today dates, fall back to the schedule window check.
  const hereNowCount = useMemo((): number => {
    if (isToday && punchesLoaded) {
      const byEmployee = new Map<number, PunchRecord[]>();
      for (const p of punchRecords) {
        if (!byEmployee.has(p.employeeId)) byEmployee.set(p.employeeId, []);
        byEmployee.get(p.employeeId)!.push(p);
      }
      let count = 0;
      for (const empPunches of byEmployee.values()) {
        if (getAttendanceStatus(empPunches) === "clocked_in") count++;
      }
      return count;
    }
    return scheduled.filter((s) => isHere(s, nowMinutes, dateKey)).length;
  }, [punchRecords, scheduled, nowMinutes, isToday, punchesLoaded, dateKey]);

  // "Scheduled" count includes employees with a shift today plus any employee who
  // has made at least one punch today (walk-ins or unscheduled arrivals).
  const scheduledCount = useMemo((): number => {
    if (isToday && punchesLoaded) {
      const ids = new Set<number>(daySchedules.map((s) => s.employeeId));
      for (const p of punchRecords) ids.add(p.employeeId);
      return ids.size;
    }
    return new Set(daySchedules.map((s) => s.employeeId)).size;
  }, [daySchedules, punchRecords, isToday, punchesLoaded]);


  const storeHours = weeklyHours[dayOfWeekForKey(dateKey)];

  const isStoreOpen = useMemo(() => {
    if (!isToday) return true; // non-today dates always show live alert
    return nowMinutes >= storeHours.open && nowMinutes < storeHours.close;
  }, [isToday, nowMinutes, storeHours]);

  const coverageStatus = useMemo((): CoverageStatus => {
    if (!isToday) return "closed";
    if (!isStoreOpen) return "closed";
    return liveCoverageStatus(hereNowCount, targetAt(dayCurve, nowMinutes));
  }, [isToday, isStoreOpen, hereNowCount, dayCurve, nowMinutes]);


  // Stay in skeleton until schedules are loaded. sharedLoading gates me/settings/storeHours;
  // employees has its own local state so it no longer blocks the skeleton.
  const isLoading = loading || sharedLoading;

  const headerProps = {
    date, today, isToday, hereCount: hereNowCount,
    nowMinutes, coverageStatus, isDemo, loading: isLoading,
    userName, isManager, coverageAlertsEnabled,
    onPrev: () => setSelectedKey(addDaysToKey(dateKey, -1)),
    onNext: () => setSelectedKey(addDaysToKey(dateKey, 1)),
    onNow: () => setSelectedKey(null),
    onDateSelect: (d: Date) => {
      const key = localDateKey(d);
      setSelectedKey(key === todayKeyInTz(timezone) ? null : key);
    },
    onSignOut: handleSignOut,
  };

  const timeline = isLoading ? <SkeletonTimeline /> : (
    <CoverageTimeline
      schedules={daySchedules}
      dayKey={dateKey}
      nowMinutes={nowMinutes}
      isToday={isToday}
      openMinutes={storeHours.open}
      closeMinutes={storeHours.close}
      punchRecords={punchRecords}
      punchesLoaded={isToday && punchesLoaded}
      timezone={timezone}
      targetBlocks={dayCurve}
    />
  );

  const statsRow = (
    <div className="flex gap-2 mb-3">
      <AnimatePresence initial={false}>
        {isToday && (
          <AnimatedStatCard
            key="here"
            index={0}
            value={hereNowCount}
            label="Here Now"
            color="#22c55e"
            loading={isLoading}
          />
        )}
      </AnimatePresence>
      <AnimatedStatCard
        key="scheduled"
        index={isToday ? 1 : 0}
        value={scheduledCount}
        label="Scheduled"
        color="#818cf8"
        loading={isLoading}
      />
      <AnimatedStatCard
        key="off"
        index={isToday ? 2 : 1}
        value={off.length}
        label="Off"
        color="#94a3b8"
        loading={isLoading}
      />
    </div>
  );

  const legend = (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.15, ease: "easeOut" }}
      className="flex gap-3 flex-wrap mb-5 px-[14px] py-3 bg-card rounded-xl border border-white/[0.05]"
      style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)" }}
    >
      {([
        { label: "Opener", color: SHIFT_COLORS.opener, Icon: SunriseIcon },
        { label: "Mid",    color: SHIFT_COLORS.mid,    Icon: SunIcon },
        { label: "Closer", color: SHIFT_COLORS.closer,  Icon: MoonIcon },
      ] as const).map(({ label, color, Icon }, i) => (
        <motion.div
          key={label}
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2 + i * 0.06, duration: 0.2 }}
          className="flex items-center gap-1.5 text-[11px] text-slate-400 bg-slate-800/60 px-2.5 py-1 rounded-full border border-slate-700/40"
        >
          <Icon size={12} color={color} />
          <span>{label}</span>
        </motion.div>
      ))}
    </motion.div>
  );

  function handleSelectShift(emp: Employee, sch: Schedule) {
    setSelected({ emp, sch });
    setAvailabilityRecords([]);
    fetch(`/api/availability?employeeId=${emp.id}`)
      .then((r) => r.json())
      .then((records: AvailabilityRecord[]) => setAvailabilityRecords(Array.isArray(records) ? records : []))
      .catch(() => setAvailabilityRecords([]));
  }
  function handleSelectOff(emp: Employee) {
    setSelected({ emp, sch: null });
    setAvailabilityRecords([]);
    if (isManager) {
      fetch(`/api/availability?employeeId=${emp.id}`)
        .then((r) => r.json())
        .then((records: AvailabilityRecord[]) => setAvailabilityRecords(Array.isArray(records) ? records : []))
        .catch(() => setAvailabilityRecords([]));
    }
  }

  const sharedSectionProps = {
    employees,
    storeHours,
    nowMinutes,
    isToday,
    dayKey: dateKey,
    attendanceMap: isToday && punchesLoaded ? attendanceMap : undefined,
    onSelect: handleSelectShift,
  };

  const calledOutSection = (
    <TeamSection
      label="Called Out"
      count={calledOutEmployees.length}
      employees={calledOutEmployees}
      nowMinutes={nowMinutes}
      isToday={isToday}
      onSelectOff={handleSelectOff}
      canSelectOff={(emp) => isManager || !!emp.user_id}
      statusLabel="Called Out"
      statusColor={CALLOUT_COLOR}
    />
  );

  const offSection = (
    <TeamSection label="Off Today" count={off.length} employees={off} nowMinutes={nowMinutes} isToday={isToday} onSelectOff={handleSelectOff} canSelectOff={(emp) => isManager || !!emp.user_id} />
  );

  const teamSections = isLoading ? (
    <><SkeletonTeamSection count={4} /><SkeletonTeamSection count={2} /></>
  ) : isToday && punchesLoaded ? (
    <>
      <TeamSection label="Here Now"  count={hereNowSchedules.length}   schedules={hereNowSchedules}   {...sharedSectionProps} />
      <TeamSection label="On Break"  count={onBreakSchedules.length}   schedules={onBreakSchedules}   {...sharedSectionProps} />
      <TeamSection label="Scheduled" count={scheduledRemaining.length}  schedules={scheduledRemaining}  {...sharedSectionProps} />
      {calledOutSection}
      {offSection}
    </>
  ) : (
    <>
      <TeamSection label="Scheduled" count={sortedScheduled.length} schedules={sortedScheduled} {...sharedSectionProps} />
      {calledOutSection}
      {offSection}
    </>
  );

  const drawer = (
    <EmployeeDrawer
      open={!!selected}
      employee={selected?.emp ?? null}
      schedule={selected?.sch ?? null}
      storeHours={storeHours}
      nowMinutes={nowMinutes}
      isToday={isToday}
      attendanceStatus={selected?.emp ? attendanceMap[selected.emp.id] : undefined}
      calledOut={selected?.emp ? calloutIds.has(selected.emp.id) : false}
      onClose={() => setSelected(null)}
      onSave={handleSaveShift}
      onCreate={handleCreateShift}
      onMarkOff={handleMarkOff}
      onResendInvite={handleResendInvite}
      onViewTimeCard={isManager && selected?.emp ? () => setTimeCardEmp(selected.emp) : undefined}
      isManager={isManager}
      date={dateKey}
      availabilityRecords={availabilityRecords}
    />
  );

  const timeCardDrawer = (
    <TimeCardDrawer
      open={!!timeCardEmp}
      employee={timeCardEmp}
      timezone={timezone}
      onClose={() => setTimeCardEmp(null)}
    />
  );

  const errorBanner = error ? (
    <div role="alert" className="mx-4 tablet:mx-6 mt-3 mb-1 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 text-center">
      {error}
    </div>
  ) : null;

  const weekButton = isManager ? (
    <Link
      href="/week"
      className="w-full mt-4 py-3 flex items-center justify-center text-sm font-semibold text-slate-300 bg-slate-800 border border-slate-700 rounded-xl hover:bg-slate-700 hover:border-slate-600 transition-colors"
    >
      Team week
    </Link>
  ) : null;

  const draftButton = isManager ? (
    <motion.button
      onClick={() => router.push("/week?mode=draft")}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className="w-full mt-4 py-3 text-sm font-bold text-white bg-gradient-to-r from-blue-500 to-violet-500 border-none rounded-xl cursor-pointer hover:brightness-110 transition-all"
    >
      Plan Draft Schedule
    </motion.button>
  ) : null;

  const exportButton = isManager ? (
    <div className="mt-4 flex flex-col gap-2">
      <motion.button
        onClick={() => setShowExport((v) => !v)}
        aria-expanded={showExport}
        aria-controls="home-export-range"
        whileTap={{ scale: 0.98 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
        className="w-full py-3 flex items-center justify-center gap-2 text-sm font-semibold text-slate-300 bg-slate-800 border border-slate-700 rounded-xl cursor-pointer hover:bg-slate-700 hover:border-slate-600 transition-colors"
      >
        Export CSV
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className={`text-slate-500 transition-transform ${showExport ? "rotate-180" : ""}`}><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </motion.button>
      {showExport && (
        <div id="home-export-range" className="flex flex-col gap-2 bg-card border border-slate-800/60 rounded-xl p-3">
          <div className="flex items-end gap-2">
            <div className="flex-1 min-w-0">
              <label htmlFor="exp-from" className="text-[10px] text-slate-500 font-semibold uppercase mb-1 block">From</label>
              <input
                id="exp-from"
                type="date"
                value={exportFrom}
                max={exportTo}
                onChange={(e) => setExportFrom(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500/70"
              />
            </div>
            <div className="flex-1 min-w-0">
              <label htmlFor="exp-to" className="text-[10px] text-slate-500 font-semibold uppercase mb-1 block">To</label>
              <input
                id="exp-to"
                type="date"
                value={exportTo}
                min={exportFrom}
                onChange={(e) => setExportTo(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500/70"
              />
            </div>
          </div>
          <motion.button
            onClick={handleExportCSV}
            disabled={exportLoading || exportFrom > exportTo}
            aria-busy={exportLoading}
            whileTap={{ scale: 0.98 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            className="w-full py-2.5 text-sm font-semibold text-indigo-400 bg-indigo-500/15 border border-indigo-500/30 rounded-xl cursor-pointer hover:bg-indigo-500/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exportLoading ? "Loading…" : "Download CSV"}
          </motion.button>
        </div>
      )}
    </div>
  ) : null;

  return (
    <AppShell
      active="team"
      isManager={isManager}
      userName={userName}
      isDemo={isDemo}
      onSignOut={handleSignOut}
    >
      {/*
       * Single responsive layout — no JS fork.
       * Mobile: linear stack inside max-w-[480px], pb-28 for the fixed BottomNav.
       * Desktop (desk, ≥1024px): 2-column grid, pb-8, no max-width.
       * Wide (≥1440px): room is reserved on the right while the employee pane is open.
       * px-4 is on the inner content wrapper (not on <main>) so the sticky
       * CoverageHeader can span the full width of its parent without fighting
       * against inherited horizontal padding.
       */}
      <main
        className={`max-w-[480px] mx-auto tablet:max-w-none tablet:pb-10 pb-28 bg-bg min-h-screen desk:max-w-none desk:pb-8 wide:transition-[padding] wide:duration-300 ${
          // Wide screens show employee detail as a side pane beside the dashboard (EmployeeDrawer)
          selected ? "wide:pr-[420px]" : ""
        }`}
      >
        <CoverageHeader {...headerProps} hideMobileBrand />
        {errorBanner}
        {/*
         * One DOM order (overview → team → manager actions), placed per size class:
         * tablet: stacked, team sections in 2 columns.
         * desk:   overview left; team list right (sticky) with actions under it.
         * wide:   overview + actions side by side; team sections in 3 columns below.
         */}
        <div className="px-4 tablet:px-6 desk:grid desk:grid-cols-[minmax(0,1fr)_380px] desk:gap-x-8 desk:pb-8 desk:items-start wide:grid-cols-[minmax(0,1fr)_340px] wide:max-w-[1680px] wide:mx-auto">
          <div className="desk:col-start-1 desk:row-start-1">
            {statsRow}
            {timeline}
            {legend}
          </div>
          <div className="tablet:grid tablet:grid-cols-2 tablet:gap-x-6 tablet:items-start desk:block desk:col-start-2 desk:row-start-1 desk:sticky desk:top-4 wide:grid wide:grid-cols-3 wide:col-start-1 wide:col-span-2 wide:row-start-2 wide:static wide:mt-2">
            {teamSections}
          </div>
          {(draftButton || weekButton || exportButton) && (
            <div className="tablet:grid tablet:grid-cols-3 tablet:gap-x-4 tablet:items-start desk:block desk:col-start-2 desk:row-start-2 wide:row-start-1 wide:-mt-4">
              {draftButton}
              {weekButton}
              {exportButton}
            </div>
          )}
        </div>
        {drawer}
        {timeCardDrawer}
        <BottomNav active="team" />
      </main>
    </AppShell>
  );
}
