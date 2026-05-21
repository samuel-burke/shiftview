"use client";

import { useMemo, useState, useEffect } from "react";
import {
  employees,
  schedules,
  Employee,
  Schedule,
  isHere,
} from "../data/mockData";
import CoverageHeader from "../components/CoverageHeader";
import CoverageTimeline from "../components/CoverageTimeline";
import TeamSection from "../components/TeamSection";
import EmployeeDrawer from "../components/EmployeeDrawer";

function toDateKey(d: Date) {
  return d.toISOString().slice(0, 10);
}
function offsetDate(d: Date, days: number) {
  const n = new Date(d);
  n.setDate(n.getDate() + days);
  return n;
}

function getNowMinutes() {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
}

export default function Page() {
  const today = new Date();
  const [date, setDate] = useState(today);
  const [selected, setSelected] = useState<{
    emp: Employee;
    sch: Schedule;
  } | null>(null);
  const [nowMinutes, setNowMinutes] = useState(getNowMinutes);

  // Update every minute
  useEffect(() => {
    const t = setInterval(() => setNowMinutes(getNowMinutes()), 60000);
    return () => clearInterval(t);
  }, []);

  const isToday = toDateKey(date) === toDateKey(today);
  const dateKey = toDateKey(date);

  const daySchedules = useMemo(
    () => schedules.filter((s) => s.date === dateKey),
    [dateKey],
  );

  const scheduled = useMemo(
    () => daySchedules.filter((s) => s.startMinutes >= 0),
    [daySchedules],
  );
  const off = useMemo(
    () => daySchedules.filter((s) => s.startMinutes < 0),
    [daySchedules],
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

  return (
    <main
      style={{
        maxWidth: 480,
        margin: "0 auto",
        padding: "24px 16px 80px",
        background: "#0a1628",
        minHeight: "100vh",
      }}
    >
      <CoverageHeader
        date={date}
        onPrev={() => setDate((d) => offsetDate(d, -1))}
        onNext={() => setDate((d) => offsetDate(d, 1))}
        onNow={() => setDate(new Date())}
        isToday={isToday}
        hereCount={hereNow.length}
        scheduledCount={scheduled.length}
        offCount={off.length}
        nowMinutes={nowMinutes}
      />

      <CoverageTimeline schedules={daySchedules} nowMinutes={nowMinutes} />

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

      <TeamSection
        label="Scheduled"
        count={scheduled.length}
        schedules={sortedScheduled}
        employees={employees}
        nowMinutes={nowMinutes}
        onSelect={(emp, sch) => setSelected({ emp, sch })}
      />

      <TeamSection
        label="Off Today"
        count={off.length}
        schedules={off}
        employees={employees}
        nowMinutes={nowMinutes}
        onSelect={(emp, sch) => setSelected({ emp, sch })}
      />

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
        onClose={() => setSelected(null)}
      />
    </main>
  );
}
