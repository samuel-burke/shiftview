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
import { createClient } from "@/lib/supabase-browser";

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
    sch: Schedule;
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

  return (
    <main
      style={{
        maxWidth: 480,
        margin: "0 auto",
        padding: "0 16px 80px",
        background: "#0a1628",
        minHeight: "100vh",
      }}
    >
      <CoverageHeader
        date={date}
        today={today}
        onPrev={() => setDate((d) => offsetDate(d, -1))}
        onNext={() => setDate((d) => offsetDate(d, 1))}
        onNow={() => setDate(new Date())}
        onDateSelect={(d) => setDate(d)}
        isToday={isToday}
        hereCount={hereNow.length}
        scheduledCount={scheduled.length}
        offCount={off.length}
        nowMinutes={nowMinutes}
        coverageStatus={coverageStatus}
        onSignOut={isDemo ? undefined : handleSignOut}
        onSignIn={isDemo ? () => router.push("/login") : undefined}
        isDemo={isDemo}
        loading={loading}
      />

      {refreshing && (
        <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
          <div className="spinner" />
        </div>
      )}

      {loading ? (
        <SkeletonTimeline />
      ) : (
        <CoverageTimeline
          schedules={daySchedules}
          nowMinutes={nowMinutes}
          isToday={isToday}
          openMinutes={storeHours.open}
          closeMinutes={storeHours.close}
        />
      )}

      {/* Legend */}
      <div
        style={{
          display: "flex",
          gap: 16,
          flexWrap: "wrap",
          marginBottom: 20,
          padding: "12px 14px",
          background: "#1a2236",
          borderRadius: 12,
        }}
      >
        {[
          { label: "Opener", color: "#f59e0b" },
          { label: "Mid", color: "#6366f1" },
          { label: "Closer", color: "#8b5cf6" },
        ].map(({ label, color }) => (
          <div
            key={label}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: color,
                display: "inline-block",
              }}
            />
            <span style={{ fontSize: 12, color: "#94a3b8" }}>{label}</span>
          </div>
        ))}
      </div>

      {loading ? (
        <>
          <SkeletonTeamSection count={4} />
          <SkeletonTeamSection count={2} />
        </>
      ) : (
        <>
          <TeamSection
            label="Scheduled"
            count={scheduled.length}
            schedules={sortedScheduled}
            employees={employees}
            nowMinutes={nowMinutes}
            isToday={isToday}
            onSelect={(emp, sch) => setSelected({ emp, sch })}
          />
          <TeamSection
            label="Off Today"
            count={off.length}
            employees={off}
            nowMinutes={nowMinutes}
            isToday={isToday}
          />
        </>
      )}

      <div
        style={{
          textAlign: "center",
          marginTop: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 12, color: "#334155" }}>
          Last updated: {lastUpdated}
        </span>
      </div>

      <EmployeeDrawer
        open={!!selected}
        employee={selected?.emp ?? null}
        schedule={selected?.sch ?? null}
        nowMinutes={nowMinutes}
        isToday={isToday}
        onClose={() => setSelected(null)}
        onSave={handleSaveShift}
        onMarkOff={handleMarkOff}
        isManager={isManager}
      />
    </main>
  );
}
