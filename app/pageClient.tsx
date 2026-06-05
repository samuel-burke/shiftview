"use client";
import { downloadCSV } from "../lib/csv-download";
import { useRouter } from "next/navigation";
import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { motion, useSpring, useTransform, AnimatePresence } from "framer-motion";
import { useSearchParams } from "next/navigation";
import {
  Employee,
  Schedule,
  PunchRecord,
  AttendanceStatus,
  StoreHours,
  AvailabilityRecord,
  isHere,
  OPTIMAL_COVERAGE,
  MINIMUM_COVERAGE,
  CoverageStatus,
  getAttendanceStatus,
  fmtMinutes,
  SHIFT_COLORS,
} from "../data/types";

const DEFAULT_HOURS: Record<number, StoreHours> = {
  0: { open: 480, close: 1200 },
  1: { open: 360, close: 1320 },
  2: { open: 360, close: 1320 },
  3: { open: 360, close: 1320 },
  4: { open: 360, close: 1320 },
  5: { open: 360, close: 1320 },
  6: { open: 360, close: 1320 },
};
import CoverageHeader from "../components/CoverageHeader";
import CoverageTimeline from "../components/CoverageTimeline";
import TeamSection from "../components/TeamSection";
import EmployeeDrawer from "../components/EmployeeDrawer";
import { SkeletonTeamSection, SkeletonTimeline } from "../components/Skeleton";
import BottomNav from "../components/BottomNav";
import AppShell from "../components/AppShell";
import { createClient } from "@/lib/supabase-browser";
import { createApiFetch } from "@/lib/api-fetch";
import { SunriseIcon, SunIcon, MoonIcon } from "../components/ShiftIcons";

function toDateKey(d: Date, tz = "America/New_York") {
  return d.toLocaleDateString("en-CA", { timeZone: tz });
}

function getNowMinutes(tz = "America/New_York") {
  const now = new Date();
  const parts = now.toLocaleTimeString("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const [h, m] = parts.split(":").map(Number);
  return h * 60 + m;
}

function offsetDate(d: Date, days: number) {
  const n = new Date(d);
  n.setDate(n.getDate() + days);
  return n;
}

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
  const today = new Date();
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [selected, setSelected] = useState<{
    emp: Employee;
    sch: Schedule | null;
  } | null>(null);
  const [availabilityRecords, setAvailabilityRecords] = useState<AvailabilityRecord[]>([]);
  const [nowMinutes, setNowMinutes] = useState(getNowMinutes);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isManager, setIsManager] = useState(false);
  const [userName, setUserName] = useState<string | null>(null);
  const [weeklyHours, setWeeklyHours] = useState<Record<number, StoreHours>>(DEFAULT_HOURS);
  const [optimalCoverage, setOptimalCoverage] = useState(OPTIMAL_COVERAGE);
  const [minCoverage, setMinCoverage] = useState(MINIMUM_COVERAGE);
  const [coverageAlertsEnabled, setCoverageAlertsEnabled] = useState(true);
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [timezone, setTimezone] = useState("America/New_York");
  const [exportLoading, setExportLoading] = useState(false);
  const [punchRecords, setPunchRecords] = useState<PunchRecord[]>([]);
  const [punchesLoaded, setPunchesLoaded] = useState(false);
  const searchParams = useSearchParams();
  const isDemo = searchParams.get("demo") === "true";
  const supabase = createClient();
  const apiFetch = createApiFetch(isDemo, () => router.push("/login"));

  // Mutable refs so subscription callbacks always see the latest date/timezone/role
  const dateRef = useRef(date);
  dateRef.current = date;
  const timezoneRef = useRef(timezone);
  timezoneRef.current = timezone;
  const isManagerRef = useRef(isManager);
  isManagerRef.current = isManager;

  // Compute Mon–Sun week dates for the week containing `date`
  const weekDatesForExport = useMemo((): string[] => {
    // Find Monday of the current week
    const d = new Date(date);
    const day = d.getDay(); // 0=Sun, 1=Mon...6=Sat
    const diff = day === 0 ? -6 : 1 - day; // shift Sunday to end
    d.setDate(d.getDate() + diff);
    return Array.from({ length: 7 }, (_, i) => toDateKey(offsetDate(d, i)));
  }, [date]);

  async function handleExportCSV() {
    const capturedDates = weekDatesForExport;
    setExportLoading(true);

    const results = await Promise.allSettled(
      capturedDates.map(d =>
        fetch(`/api/schedules?date=${d}&demo=${isDemo}`).then(r => r.json())
      )
    );

    if (results.some(r => r.status === "rejected")) {
      setError("Failed to load schedule data for export. Please try again.");
      setExportLoading(false);
      return;
    }

    const allSchedules = results.flatMap(r => r.status === "fulfilled" ? r.value as Schedule[] : []);

    // Build header row: Employee, Mon DATE, Tue DATE, ...
    const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    const headerCols = capturedDates.map((d, i) => `${DAY_LABELS[i]} ${d}`);
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
    const weekStartDate = capturedDates[0];
    const blob = new Blob([csvContent], { type: "text/csv" });
    downloadCSV(blob, `schedule-${weekStartDate}.csv`);

    setExportLoading(false);
  }

  type TimeOffRequest = {
    id: number;
    employeeId: number;
    employeeName: string;
    date: string;
    note?: string;
    status: string;
  };
  const [pendingTimeOff, setPendingTimeOff] = useState<TimeOffRequest[]>([]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  async function handleSaveShift(scheduleId: number, startMinutes: number, endMinutes: number, override = false) {
    if (isDemo) {
      setSchedules((prev) =>
        prev.map((s) => s.id === scheduleId ? { ...s, startMinutes, endMinutes } : s)
      );
      return;
    }
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
    const dateKey = toDateKey(date, timezone);
    const data = await apiFetch(`/api/schedules?date=${dateKey}&demo=${isDemo}`).then((r) => r.json());
    setSchedules(data);
    setLastFetchedAt(new Date());
  }

  async function handleCreateShift(employeeId: number, startMinutes: number, endMinutes: number, override = false) {
    if (isDemo) {
      setSchedules((prev) => [
        ...prev,
        { id: Date.now(), employeeId, date: toDateKey(date, timezone), startMinutes, endMinutes },
      ]);
      return;
    }
    const dateKey = toDateKey(date, timezone);
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
    const data2 = await apiFetch(`/api/schedules?date=${dateKey}&demo=${isDemo}`).then((r) => r.json());
    setSchedules(data2);
    setLastFetchedAt(new Date());
  }

  async function handleResendInvite(email: string) {
    if (isDemo) return;
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
    if (isDemo) {
      setSchedules((prev) => prev.filter((s) => s.id !== scheduleId));
      return;
    }
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
    if (isDemo) return;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.push("/login");
    });
    return () => subscription.unsubscribe();
  }, [isDemo]);

  async function handleApproveTimeOff(id: number) {
    const res = await fetch(`/api/time-off/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    if (!res.ok) {
      const { error } = await res.json();
      throw new Error(error ?? "Failed to approve request");
    }
    setPendingTimeOff((prev) => prev.filter((r) => r.id !== id));
    // Refresh schedules for current date after approval
    const dateKey = toDateKey(date, timezone);
    apiFetch(`/api/schedules?date=${dateKey}&demo=${isDemo}`)
      .then((r) => r.json())
      .then(setSchedules)
      .catch(() => {});
  }

  async function handleDenyTimeOff(id: number) {
    const res = await fetch(`/api/time-off/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "denied" }),
    });
    if (!res.ok) {
      const { error } = await res.json();
      throw new Error(error ?? "Failed to deny request");
    }
    setPendingTimeOff((prev) => prev.filter((r) => r.id !== id));
  }

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setNowMinutes(getNowMinutes(timezone)), 60000);
    return () => clearInterval(t);
  }, [timezone]);

  // Supabase Realtime — live punch updates while viewing today (manager only)
  useEffect(() => {
    const viewingToday = toDateKey(date, timezone) === toDateKey(new Date(), timezone);
    if (!viewingToday || isDemo || !isManager) return;

    const todayKey = toDateKey(new Date(), timezone);

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
          const punchDate = new Date(p.punched_at as string).toLocaleDateString("en-CA", { timeZone: timezone });
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
      const dateKey = toDateKey(date, timezone);
      apiFetch(`/api/punches?date=${dateKey}`)
        .then((r) => r.json())
        .then((data) => { setPunchRecords(Array.isArray(data) ? data : []); })
        .catch(() => {});
    }, 300000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(t);
    };
  }, [isDemo, isManager, date, timezone]);

  // Supabase Realtime — live updates for schedules, employees, time-off, store hours, settings
  useEffect(() => {
    if (isDemo) return;

    function refetchSchedules() {
      const dk = toDateKey(dateRef.current, timezoneRef.current);
      apiFetch(`/api/schedules?date=${dk}`)
        .then((r) => r.json())
        .then(setSchedules)
        .catch(() => {});
    }

    function refetchEmployees() {
      apiFetch("/api/employees")
        .then((r) => r.json())
        .then(setEmployees)
        .catch(() => {});
    }

    function refetchTimeOff() {
      if (!isManagerRef.current) return;
      fetch("/api/time-off")
        .then((r) => r.json())
        .then(({ requests }) => { if (Array.isArray(requests)) setPendingTimeOff(requests); })
        .catch(() => {});
    }

    function refetchStoreHours() {
      fetch("/api/store-hours")
        .then((r) => r.json())
        .then((data) => setWeeklyHours((prev) => ({ ...prev, ...data })))
        .catch(() => {});
    }

    function refetchSettings() {
      fetch("/api/settings")
        .then((r) => r.json())
        .then(({ optimalCoverage: oc, minCoverage: mc, timezone: tz, coverageAlertsEnabled: ca }) => {
          if (oc != null) setOptimalCoverage(oc);
          if (mc != null) setMinCoverage(mc);
          if (tz) setTimezone(tz);
          if (ca != null) setCoverageAlertsEnabled(ca);
        })
        .catch(() => {});
    }

    const channel = supabase
      .channel("main-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "schedules" }, refetchSchedules)
      .on("postgres_changes", { event: "*", schema: "public", table: "employees" }, refetchEmployees)
      .on("postgres_changes", { event: "*", schema: "public", table: "time_off_requests" }, refetchTimeOff)
      .on("postgres_changes", { event: "*", schema: "public", table: "store_hours" }, refetchStoreHours)
      .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, refetchSettings)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [isDemo]);

  // Fetch employees, manager status, store hours, and settings in parallel on mount
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    Promise.allSettled([
      apiFetch(`/api/employees?demo=${isDemo}`, { signal }),
      apiFetch(`/api/me${isDemo ? "?demo=true" : ""}`, { signal }),
      apiFetch("/api/store-hours", { signal }),
      apiFetch("/api/settings", { signal }),
    ]).then(([empsResult, meResult, hoursResult, settingsResult]) => {
      if (empsResult.status === "fulfilled") {
        if (!empsResult.value.ok) {
          console.error("[pageClient] fetch failed: /api/employees returned", empsResult.value.status);
          setError("Failed to load employees");
        } else {
          empsResult.value.json().then(setEmployees);
        }
      } else {
        if (empsResult.reason?.name !== "AbortError") {
          console.error("[pageClient] fetch failed:", empsResult.reason);
          setError("Failed to load employees");
        }
      }
      if (meResult.status === "fulfilled") {
        if (!meResult.value.ok) {
          console.error("[pageClient] fetch failed: /api/me returned", meResult.value.status);
        } else {
          meResult.value.json().then(({ isManager: mgr, employeeName }) => {
            setIsManager(mgr);
            setUserName(employeeName ?? null);
            if (mgr && !isDemo) {
              fetch("/api/time-off")
                .then((r) => r.json())
                .then(({ requests }) => { if (Array.isArray(requests)) setPendingTimeOff(requests); })
                .catch(() => {});
            }
          });
        }
      } else {
        if (meResult.reason?.name !== "AbortError") {
          console.error("[pageClient] fetch failed:", meResult.reason);
        }
      }
      if (hoursResult.status === "fulfilled") {
        if (!hoursResult.value.ok) {
          console.error("[pageClient] fetch failed: /api/store-hours returned", hoursResult.value.status);
        } else {
          hoursResult.value.json().then((data) => setWeeklyHours((prev) => ({ ...prev, ...data })));
        }
      } else {
        if (hoursResult.reason?.name !== "AbortError") {
          console.error("[pageClient] fetch failed:", hoursResult.reason);
        }
      }
      if (settingsResult.status === "fulfilled") {
        if (!settingsResult.value.ok) {
          console.error("[pageClient] fetch failed: /api/settings returned", settingsResult.value.status);
        } else {
          settingsResult.value.json().then(({ optimalCoverage, minCoverage, timezone: tz, coverageAlertsEnabled: ca }) => {
            if (optimalCoverage != null) setOptimalCoverage(optimalCoverage);
            if (minCoverage != null) setMinCoverage(minCoverage);
            if (ca != null) setCoverageAlertsEnabled(ca);
            if (tz) {
              setTimezone(tz);
              setNowMinutes(getNowMinutes(tz));
            }
          });
        }
      } else {
        if (settingsResult.reason?.name !== "AbortError") {
          console.error("[pageClient] fetch failed:", settingsResult.reason);
        }
      }
    });

    return () => controller.abort();
  }, []);

  // Fetch schedules (and punch records for today) whenever date changes
  useEffect(() => {
    const dateKey = toDateKey(date, timezone);
    setLoading(true);
    setError(null);
    const isViewingToday = dateKey === toDateKey(today, timezone);
    setPunchesLoaded(false);
    const fetches: Promise<void>[] = [
      apiFetch(`/api/schedules?date=${dateKey}&demo=${isDemo}`)
        .then((r) => r.json())
        .then((data) => {
          setSchedules(data);
          setLastFetchedAt(new Date());
        }),
    ];
    if (isViewingToday && !isDemo) {
      fetches.push(
        apiFetch(`/api/punches?date=${dateKey}`)
          .then((r) => r.json())
          .then((data) => {
            setPunchRecords(Array.isArray(data) ? data : []);
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
        setError("Failed to load schedules");
        setLoading(false);
      });
  }, [date, timezone]);

  const isToday = toDateKey(date, timezone) === toDateKey(today, timezone);
  const dateKey = toDateKey(date, timezone);

  const daySchedules = useMemo(
    () => schedules.filter((s) => s.date.slice(0, 10) === dateKey),
    [schedules, dateKey],
  );
  const scheduled = daySchedules;
  const off = useMemo(
    () => employees.filter((emp) => !daySchedules.some((s) => s.employeeId === emp.id)),
    [employees, daySchedules],
  );
  const sortedScheduled = useMemo(
    () => [...scheduled].sort((a, b) => a.startMinutes - b.startMinutes),
    [scheduled],
  );

  // Build a map from employeeId → AttendanceStatus using real punch records.
  // Only populated once punch data has loaded so we don't flash "Not Here Yet"
  // before the fetch completes.
  const attendanceMap = useMemo((): Record<number, AttendanceStatus> => {
    if (!punchesLoaded) return {};
    const map: Record<number, AttendanceStatus> = {};
    for (const sch of scheduled) {
      const empPunches = punchRecords.filter((p) => p.employeeId === sch.employeeId);
      map[sch.employeeId] = getAttendanceStatus(empPunches);
    }
    return map;
  }, [punchRecords, scheduled, punchesLoaded]);

  // When punch data is loaded for today, count employees actually clocked in.
  // On past/future dates or before punch data arrives, fall back to schedule window.
  const hereNow = useMemo(() => {
    if (isToday && punchesLoaded) {
      return scheduled.filter((s) => attendanceMap[s.employeeId] === "clocked_in");
    }
    return scheduled.filter((s) => isHere(s, nowMinutes));
  }, [scheduled, nowMinutes, isToday, punchesLoaded, attendanceMap]);


  const storeHours = weeklyHours[date.getDay()];

  const isStoreOpen = useMemo(() => {
    if (!isToday) return true; // non-today dates always show live alert
    return nowMinutes >= storeHours.open && nowMinutes < storeHours.close;
  }, [isToday, nowMinutes, storeHours]);

  const coverageStatus = useMemo((): CoverageStatus => {
    if (!isToday) return "closed";
    if (!isStoreOpen) return "closed";
    if (hereNow.length < minCoverage) return "critical";
    if (hereNow.length < optimalCoverage) return "low";
    return "optimal";
  }, [isToday, isStoreOpen, hereNow.length]);


  const headerProps = {
    date, today, isToday, hereCount: hereNow.length,
    nowMinutes, coverageStatus, isDemo, loading,
    userName, isManager, coverageAlertsEnabled,
    onPrev: () => { setLastFetchedAt(null); setDate((d) => offsetDate(d, -1)); },
    onNext: () => { setLastFetchedAt(null); setDate((d) => offsetDate(d, 1)); },
    onNow: () => setDate(new Date()),
    onDateSelect: (d: Date) => setDate(d),
    onSignOut: isDemo ? undefined : handleSignOut,
    onSignIn: isDemo ? () => router.push("/login") : undefined,
  };

  const timeline = loading ? <SkeletonTimeline /> : (
    <CoverageTimeline
      schedules={daySchedules}
      nowMinutes={nowMinutes}
      isToday={isToday}
      openMinutes={storeHours.open}
      closeMinutes={storeHours.close}
      punchRecords={punchRecords}
      timezone={timezone}
    />
  );

  const statsRow = (
    <div className="flex gap-2 mb-3">
      <AnimatePresence initial={false}>
        {isToday && (
          <AnimatedStatCard
            key="here"
            index={0}
            value={hereNow.length}
            label="Here Now"
            color="#22c55e"
            loading={loading}
          />
        )}
      </AnimatePresence>
      <AnimatedStatCard
        key="scheduled"
        index={isToday ? 1 : 0}
        value={scheduled.length}
        label="Scheduled"
        color="#818cf8"
        loading={loading}
      />
      <AnimatedStatCard
        key="off"
        index={isToday ? 2 : 1}
        value={off.length}
        label="Off"
        color="#94a3b8"
        loading={loading}
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

  const teamSections = loading ? (
    <><SkeletonTeamSection count={4} /><SkeletonTeamSection count={2} /></>
  ) : (
    <>
      <TeamSection label="Scheduled" count={scheduled.length} schedules={sortedScheduled} employees={employees} storeHours={storeHours} nowMinutes={nowMinutes} isToday={isToday} attendanceMap={isToday && isManager ? attendanceMap : undefined} onSelect={(emp, sch) => { setSelected({ emp, sch }); setAvailabilityRecords([]); fetch(`/api/availability?employeeId=${emp.id}`).then((r) => r.json()).then((records: AvailabilityRecord[]) => setAvailabilityRecords(Array.isArray(records) ? records : [])).catch(() => setAvailabilityRecords([])); }} />
      <TeamSection label="Off Today" count={off.length} employees={off} nowMinutes={nowMinutes} isToday={isToday} onSelectOff={(emp) => { setSelected({ emp, sch: null }); setAvailabilityRecords([]); if (isManager) { fetch(`/api/availability?employeeId=${emp.id}`).then((r) => r.json()).then((records: AvailabilityRecord[]) => setAvailabilityRecords(Array.isArray(records) ? records : [])).catch(() => setAvailabilityRecords([])); } }} canSelectOff={(emp) => isManager || !!emp.user_id} />
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
      onClose={() => setSelected(null)}
      onSave={handleSaveShift}
      onCreate={handleCreateShift}
      onMarkOff={handleMarkOff}
      onResendInvite={handleResendInvite}
      isManager={isManager}
      date={toDateKey(date)}
      availabilityRecords={availabilityRecords}
    />
  );

  const errorBanner = error ? (
    <div role="alert" className="mx-4 mt-3 mb-1 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 text-center">
      {error}
    </div>
  ) : null;

  const exportButton = isManager ? (
    <motion.button
      onClick={handleExportCSV}
      disabled={exportLoading}
      aria-busy={exportLoading}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className="w-full mt-4 py-2.5 text-sm font-semibold text-slate-300 bg-slate-800 border border-slate-700 rounded-xl cursor-pointer hover:bg-slate-700 hover:border-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {exportLoading ? "Loading…" : "Export CSV"}
    </motion.button>
  ) : null;

  return (
    <AppShell active="team" isManager={isManager}>
      {/*
       * Single responsive layout — no JS fork.
       * Mobile: linear stack inside max-w-[480px], pb-28 for the fixed BottomNav.
       * Desktop (≥900px): 2-column grid, pb-8, no max-width.
       * px-4 is on the inner content wrapper (not on <main>) so the sticky
       * CoverageHeader can span the full width of its parent without fighting
       * against inherited horizontal padding.
       */}
      <main className="max-w-[480px] mx-auto pb-28 bg-bg min-h-screen [@media(min-width:900px)]:max-w-none [@media(min-width:900px)]:pb-8">
        <CoverageHeader {...headerProps} />
        {errorBanner}
        <div className="px-4 [@media(min-width:900px)]:grid [@media(min-width:900px)]:grid-cols-[1fr_380px] [@media(min-width:900px)]:gap-8 [@media(min-width:900px)]:px-6 [@media(min-width:900px)]:pb-8 [@media(min-width:900px)]:items-start">
          <div>
            {statsRow}
            {timeline}
            {legend}
          </div>
          <div className="[@media(min-width:900px)]:sticky [@media(min-width:900px)]:top-4">
            {teamSections}
            {exportButton}
          </div>
        </div>
        {drawer}
        <BottomNav active="team" />
      </main>
    </AppShell>
  );
}
