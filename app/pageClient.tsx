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
import InviteSheet from "../components/InviteSheet";
import { createClient } from "@/lib/supabase-browser";
import { useIsDesktop } from "../hooks/useIsDesktop";

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
  const [weeklyHours, setWeeklyHours] = useState<Record<number, StoreHours>>(DEFAULT_HOURS);
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
      .then(({ isManager }) => setIsManager(isManager))
      .catch(() => {});
    fetch("/api/store-hours")
      .then((r) => r.json())
      .then((data) => setWeeklyHours((prev) => ({ ...prev, ...data })))
      .catch(() => {}); // fall back to DEFAULT_HOURS on error
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
    if (hereNow.length < MINIMUM_COVERAGE) return "critical";
    if (hereNow.length < OPTIMAL_COVERAGE) return "low";
    return "optimal";
  }, [isToday, isStoreOpen, hereNow.length]);

  const isDesktop = useIsDesktop();
  const [showInvite, setShowInvite] = useState(false);
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
    <div style={{ flex: 1, background: "#1a2236", borderRadius: 12, padding: "12px 8px", textAlign: "center", border: `1px solid ${color}33` }}>
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
          <div className="skeleton" style={{ height: 28, width: 32, borderRadius: 6 }} />
        </div>
      ) : (
        <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
      )}
      <div style={{ fontSize: 11, color: "#64748b", marginTop: 4, fontWeight: 500 }}>{label}</div>
    </div>
  );

  const statsRow = (
    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
      {isToday && statCard(hereNow.length, "Here Now", "#22c55e")}
      {statCard(scheduled.length, "Scheduled", "#6366f1")}
      {statCard(off.length, "Off", "#475569")}
    </div>
  );

  const legend = (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 20, padding: "12px 14px", background: "#1a2236", borderRadius: 12 }}>
      {[{ label: "Opener", color: "#f59e0b" }, { label: "Mid", color: "#6366f1" }, { label: "Closer", color: "#8b5cf6" }].map(({ label, color }) => (
        <div key={label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, display: "inline-block" }} />
          <span style={{ fontSize: 12, color: "#94a3b8" }}>{label}</span>
        </div>
      ))}
    </div>
  );

  const teamSections = loading ? (
    <><SkeletonTeamSection count={4} /><SkeletonTeamSection count={2} /></>
  ) : (
    <>
      <TeamSection label="Scheduled" count={scheduled.length} schedules={sortedScheduled} employees={employees} nowMinutes={nowMinutes} isToday={isToday} onSelect={(emp, sch) => setSelected({ emp, sch })} />
      <TeamSection label="Off Today" count={off.length} employees={off} nowMinutes={nowMinutes} isToday={isToday} onSelectOff={isManager ? (emp) => setSelected({ emp, sch: null }) : undefined} />
      {isManager && !isDemo && (
        <button onClick={() => setShowInvite(true)} style={{ width: "100%", marginTop: 8, padding: "14px 0", borderRadius: 12, background: "transparent", border: "1px dashed #334155", color: "#475569", fontWeight: 600, fontSize: 14, cursor: "pointer" }}>
          + Add Employee
        </button>
      )}
    </>
  );

  const drawer = (
    <EmployeeDrawer
      open={!!selected}
      employee={selected?.emp ?? null}
      schedule={selected?.sch ?? null}
      nowMinutes={nowMinutes}
      isToday={isToday}
      onClose={() => setSelected(null)}
      onSave={handleSaveShift}
      onCreate={handleCreateShift}
      onMarkOff={handleMarkOff}
      isManager={isManager}
    />
  );

  const inviteSheet = (
    <InviteSheet
      open={showInvite}
      onClose={() => setShowInvite(false)}
      onSuccess={() => {
        setShowInvite(false);
        fetch(`/api/employees?demo=${isDemo}`).then((r) => r.json()).then(setEmployees).catch(() => {});
      }}
    />
  );

  if (isDesktop) {
    return (
      <main style={{ background: "#0a1628", minHeight: "100vh" }}>
        <CoverageHeader {...headerProps} />
        {refreshing && <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}><div className="spinner" /></div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 32, padding: "0 24px 32px", alignItems: "start" }}>
          {/* Left: stats + timeline + legend */}
          <div>
            {statsRow}
            {timeline}
            {legend}
            <div style={{ textAlign: "center", marginTop: 8 }}>
              <span style={{ fontSize: 12, color: "#334155" }}>Last updated: {lastUpdated}</span>
            </div>
          </div>
          {/* Right: team list */}
          <div style={{ position: "sticky", top: 16 }}>
            {teamSections}
          </div>
        </div>
        {drawer}
        {inviteSheet}
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: "0 16px 80px", background: "#0a1628", minHeight: "100vh" }}>
      <CoverageHeader {...headerProps} />
      {refreshing && <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}><div className="spinner" /></div>}
      {statsRow}
      {timeline}
      {legend}
      {teamSections}
      <div style={{ textAlign: "center", marginTop: 16 }}>
        <span style={{ fontSize: 12, color: "#334155" }}>Last updated: {lastUpdated}</span>
      </div>
      {drawer}
      {inviteSheet}
    </main>
  );
}
