"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import {
  Employee,
  Schedule,
  StoreHours,
  isHere,
  OPTIMAL_COVERAGE,
  MINIMUM_COVERAGE,
  CoverageStatus,
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
import { createClient } from "@/lib/supabase-browser";
import { createApiFetch } from "@/lib/api-fetch";
import { useIsDesktop } from "../hooks/useIsDesktop";
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

export default function Page() {
  const today = new Date();
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [selected, setSelected] = useState<{
    emp: Employee;
    sch: Schedule | null;
  } | null>(null);
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
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [timezone, setTimezone] = useState("America/New_York");
  const searchParams = useSearchParams();
  const isDemo = searchParams.get("demo") === "true";
  const supabase = createClient();
  const apiFetch = createApiFetch(isDemo, () => router.push("/login"));

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  async function handleSaveShift(scheduleId: number, startMinutes: number, endMinutes: number) {
    if (isDemo) {
      setSchedules((prev) =>
        prev.map((s) => s.id === scheduleId ? { ...s, startMinutes, endMinutes } : s)
      );
      return;
    }
    const res = await apiFetch("/api/schedules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: scheduleId, startMinutes, endMinutes }),
    });
    if (!res.ok) {
      const { error } = await res.json();
      throw new Error(error ?? "Failed to save shift");
    }
    const dateKey = toDateKey(date, timezone);
    const data = await apiFetch(`/api/schedules?date=${dateKey}&demo=${isDemo}`).then((r) => r.json());
    setSchedules(data);
    setLastFetchedAt(new Date());
  }

  async function handleCreateShift(employeeId: number, startMinutes: number, endMinutes: number) {
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
      body: JSON.stringify({ employeeId, date: dateKey, startMinutes, endMinutes }),
    });
    if (!res.ok) {
      const { error } = await res.json();
      throw new Error(error ?? "Failed to add shift");
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

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setNowMinutes(getNowMinutes(timezone)), 60000);
    return () => clearInterval(t);
  }, [timezone]);

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
          meResult.value.json().then(({ isManager, employeeName }) => {
            setIsManager(isManager);
            setUserName(employeeName ?? null);
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
          settingsResult.value.json().then(({ optimalCoverage, minCoverage, timezone: tz }) => {
            if (optimalCoverage != null) setOptimalCoverage(optimalCoverage);
            if (minCoverage != null) setMinCoverage(minCoverage);
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

  // Fetch schedules whenever date changes
  useEffect(() => {
    const dateKey = toDateKey(date, timezone);
    setLoading(true);
    setError(null);
    apiFetch(`/api/schedules?date=${dateKey}&demo=${isDemo}`)
      .then((r) => r.json())
      .then((data) => {
        setSchedules(data);
        setLastFetchedAt(new Date());
        setLoading(false);
      })
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
  const hereNow = useMemo(
    () => scheduled.filter((s) => isHere(s, nowMinutes)),
    [scheduled, nowMinutes],
  );
  const sortedScheduled = useMemo(
    () => [...scheduled].sort((a, b) => a.startMinutes - b.startMinutes),
    [scheduled],
  );

  const lastUpdated = lastFetchedAt
    ? lastFetchedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/New_York" })
    : null;

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

  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);

  async function handleCopyLastWeek() {
    setCopying(true);
    setCopyStatus(null);
    const toDate = toDateKey(date);
    const fromDate = toDateKey(offsetDate(date, -7));
    try {
      const res = await fetch("/api/schedules/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromDate, toDate }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to copy");
      // Refresh schedules
      const fresh = await fetch(`/api/schedules?date=${toDate}${isDemo ? `&demo=${isDemo}` : ""}`).then(r => r.json());
      setSchedules(Array.isArray(fresh) ? fresh : []);
      setCopyStatus(data.copied === 0 ? "Nothing to copy" : `${data.copied} shift${data.copied !== 1 ? "s" : ""} copied`);
      setTimeout(() => setCopyStatus(null), 4000);
    } catch (e) {
      setCopyStatus(e instanceof Error ? e.message : "Failed to copy");
    } finally {
      setCopying(false);
    }
  }

  const isDesktop = useIsDesktop();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let startY: number | null = null;
    let startX: number | null = null;

    function onTouchStart(e: TouchEvent) {
      startY = e.touches[0].clientY;
      startX = e.touches[0].clientX;
    }

    async function onTouchEnd(e: TouchEvent) {
      if (startY === null || startX === null) return;
      const diffY = e.changedTouches[0].clientY - startY;
      const diffX = startX - e.changedTouches[0].clientX;

      // Pull to refresh — only when at top of page and pulling down
      if (diffY > 80 && Math.abs(diffX) < 30 && window.scrollY === 0) {
        setRefreshing(true);
        const dateKey = toDateKey(date, timezone);
        try {
          await Promise.all([
            apiFetch(`/api/employees?demo=${isDemo}`, { cache: "no-store" })
              .then((r) => r.json())
              .then(setEmployees),
            apiFetch(`/api/schedules?date=${dateKey}&demo=${isDemo}`, {
              cache: "no-store",
            })
              .then((r) => r.json())
              .then(setSchedules),
          ]);
          setLastFetchedAt(new Date());
        } finally {
          setRefreshing(false);
        }
      }
    }

    window.addEventListener("touchstart", onTouchStart);
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [date, isDemo, timezone]);

  const headerProps = {
    date, today, isToday, hereCount: hereNow.length,
    nowMinutes, coverageStatus, isDemo, loading,
    userName, isManager,
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
    />
  );

  const statCard = (value: number, label: string, color: string) => (
    <div
      className="flex-1 bg-card rounded-xl px-2 py-3 text-center"
      style={{ border: `1px solid ${color}33` }}
    >
      {loading ? (
        <div className="flex justify-center mb-1.5">
          <div className="skeleton h-7 w-8 rounded-[6px]" />
        </div>
      ) : (
        <div className="text-[28px] font-extrabold leading-none" style={{ color }}>{value}</div>
      )}
      <div className="text-[11px] text-slate-400 mt-1 font-medium">{label}</div>
    </div>
  );

  const statsRow = (
    <div className="flex gap-2 mb-3">
      {isToday && statCard(hereNow.length, "Here Now", "#22c55e")}
      {statCard(scheduled.length, "Scheduled", "#818cf8")}
      {statCard(off.length, "Off", "#94a3b8")}
    </div>
  );

  const legend = (
    <div className="flex gap-4 flex-wrap mb-5 px-[14px] py-3 bg-card rounded-xl">
      {([
        { label: "Opener", color: "#f59e0b", Icon: SunriseIcon },
        { label: "Mid",    color: "#34d399", Icon: SunIcon },
        { label: "Closer", color: "#a78bfa", Icon: MoonIcon },
      ] as const).map(({ label, color, Icon }) => (
        <div key={label} className="flex items-center gap-1.5">
          <Icon size={13} color={color} />
          <span className="text-xs text-slate-400">{label}</span>
        </div>
      ))}
    </div>
  );

  const teamSections = loading ? (
    <><SkeletonTeamSection count={4} /><SkeletonTeamSection count={2} /></>
  ) : (
    <>
      <TeamSection label="Scheduled" count={scheduled.length} schedules={sortedScheduled} employees={employees} storeHours={storeHours} nowMinutes={nowMinutes} isToday={isToday} onSelect={(emp, sch) => setSelected({ emp, sch })} />
      <TeamSection label="Off Today" count={off.length} employees={off} nowMinutes={nowMinutes} isToday={isToday} onSelectOff={isManager ? (emp) => setSelected({ emp, sch: null }) : undefined} />
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
    />
  );

  const errorBanner = error ? (
    <div className="mx-4 mt-3 mb-1 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 text-center">
      {error}
    </div>
  ) : null;

  const copyLastWeekBar = (
    <>
      {isManager && !isDemo && (
        <button
          onClick={handleCopyLastWeek}
          disabled={copying}
          className="text-xs font-semibold text-slate-300 bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 cursor-pointer disabled:opacity-50 print:hidden"
        >
          {copying ? "Copying…" : "Copy Last Week"}
        </button>
      )}
      {copyStatus && (
        <span className="text-xs text-slate-400">{copyStatus}</span>
      )}
    </>
  );

  if (isDesktop) {
    return (
      <main className="bg-bg min-h-screen">
        <CoverageHeader {...headerProps} />
        {refreshing && <div className="flex justify-center py-2"><div className="spinner" /></div>}
        {errorBanner}
        <div className="grid grid-cols-[1fr_380px] gap-8 px-6 pb-28 items-start">
          {/* Left: stats + timeline + legend */}
          <div>
            {statsRow}
            {(isManager && !isDemo || copyStatus) && (
              <div className="flex items-center gap-3 mb-3 print:hidden">
                {copyLastWeekBar}
              </div>
            )}
            {timeline}
            {legend}
            <div className="text-center mt-2">
              <span className="text-xs text-slate-400">Last updated: {lastUpdated ?? "…"}</span>
            </div>
          </div>
          {/* Right: team list */}
          <div className="sticky top-4">
            {teamSections}
          </div>
        </div>
        {drawer}
        <BottomNav active="team" />
      </main>
    );
  }

  return (
    <main className="max-w-[480px] mx-auto px-4 pb-28 bg-bg min-h-screen">
      <CoverageHeader {...headerProps} />
      {refreshing && <div className="flex justify-center py-2"><div className="spinner" /></div>}
      {errorBanner}
      {statsRow}
      {(isManager && !isDemo || copyStatus) && (
        <div className="flex items-center gap-3 mb-3 print:hidden">
          {copyLastWeekBar}
        </div>
      )}
      {timeline}
      {legend}
      {teamSections}
      <div className="text-center mt-4">
        <span className="text-xs text-slate-400">Last updated: {lastUpdated ?? "…"}</span>
      </div>
      {drawer}
      <BottomNav active="team" />
    </main>
  );
}
