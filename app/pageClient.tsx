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
import { useIsDesktop } from "../hooks/useIsDesktop";
import { SunriseIcon, SunIcon, MoonIcon } from "../components/ShiftIcons";

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
  const searchParams = useSearchParams();
  const isDemo = searchParams.get("demo") === "true";
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  async function handleSaveShift(scheduleId: number, startMinutes: number, endMinutes: number) {
    const res = await fetch("/api/schedules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: scheduleId, startMinutes, endMinutes }),
    });
    if (!res.ok) {
      const { error } = await res.json();
      throw new Error(error ?? "Failed to save shift");
    }
    const dateKey = toDateKey(date);
    const data = await fetch(`/api/schedules?date=${dateKey}&demo=${isDemo}`).then((r) => r.json());
    setSchedules(data);
  }

  async function handleCreateShift(employeeId: number, startMinutes: number, endMinutes: number) {
    const dateKey = toDateKey(date);
    const res = await fetch("/api/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId, date: dateKey, startMinutes, endMinutes }),
    });
    if (!res.ok) {
      const { error } = await res.json();
      throw new Error(error ?? "Failed to add shift");
    }
    const data = await fetch(`/api/schedules?date=${dateKey}&demo=${isDemo}`).then((r) => r.json());
    setSchedules(data);
  }

  async function handleResendInvite(email: string) {
    const res = await fetch("/api/invites", {
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
    const res = await fetch("/api/schedules", {
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
  // Live clock
  useEffect(() => {
    const t = setInterval(() => setNowMinutes(getNowMinutes()), 60000);
    return () => clearInterval(t);
  }, []);

  // Fetch employees, manager status, and store hours once on mount
  useEffect(() => {
    fetch(`/api/employees?demo=${isDemo}`)
      .then((r) => r.json())
      .then(setEmployees)
      .catch(() => setError("Failed to load employees"));
    fetch("/api/me")
      .then((r) => r.json())
      .then(({ isManager, employeeName }) => {
        setIsManager(isManager);
        setUserName(employeeName ?? null);
      })
      .catch(() => {});
    fetch("/api/store-hours")
      .then((r) => r.json())
      .then((data) => setWeeklyHours((prev) => ({ ...prev, ...data })))
      .catch(() => {});
    fetch("/api/settings")
      .then((r) => r.json())
      .then(({ optimalCoverage, minCoverage }) => {
        if (optimalCoverage != null) setOptimalCoverage(optimalCoverage);
        if (minCoverage != null) setMinCoverage(minCoverage);
      })
      .catch(() => {});
  }, []);

  // Fetch schedules whenever date changes
  useEffect(() => {
    const dateKey = toDateKey(date);
    setLoading(true);
    setError(null);
    fetch(`/api/schedules?date=${dateKey}&demo=${isDemo}`)
      .then((r) => r.json())
      .then((data) => {
        setSchedules(data);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load schedules");
        setLoading(false);
      });
  }, [date]);

  const isToday = toDateKey(date) === toDateKey(today);
  const dateKey = toDateKey(date);

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

  const lastUpdated = (() => {
    const h = Math.floor(nowMinutes / 60);
    const m = nowMinutes % 60;
    const ampm = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
  })();

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
        const dateKey = toDateKey(date);
        await Promise.all([
          fetch(`/api/employees?demo=${isDemo}`, { cache: "no-store" })
            .then((r) => r.json())
            .then(setEmployees),
          fetch(`/api/schedules?date=${dateKey}&demo=${isDemo}`, {
            cache: "no-store",
          })
            .then((r) => r.json())
            .then(setSchedules),
        ]);
        setRefreshing(false);
      }
    }

    window.addEventListener("touchstart", onTouchStart);
    window.addEventListener("touchend", onTouchEnd);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchend", onTouchEnd);
    };
  }, [date, isDemo]);

  const headerProps = {
    date, today, isToday, hereCount: hereNow.length,
    nowMinutes, coverageStatus, isDemo, loading,
    userName, isManager,
    onPrev: () => setDate((d) => offsetDate(d, -1)),
    onNext: () => setDate((d) => offsetDate(d, 1)),
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
            {timeline}
            {legend}
            <div className="text-center mt-2">
              <span className="text-xs text-slate-400">Last updated: {lastUpdated}</span>
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
      {timeline}
      {legend}
      {teamSections}
      <div className="text-center mt-4">
        <span className="text-xs text-slate-400">Last updated: {lastUpdated}</span>
      </div>
      {drawer}
      <BottomNav active="team" />
    </main>
  );
}
