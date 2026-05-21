"use client";

import { OPTIMAL_COVERAGE, MINIMUM_COVERAGE } from "../data/mockData";

type Props = {
  date: Date;
  onPrev: () => void;
  onNext: () => void;
  onNow: () => void;
  isToday: boolean;
  hereCount: number;
  scheduledCount: number;
  offCount: number;
  nowMinutes: number;
};

function fmtTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return min === 0
    ? `${h12}:00 ${ampm}`
    : `${h12}:${String(min).padStart(2, "0")} ${ampm}`;
}

export default function CoverageHeader({
  date,
  onPrev,
  onNext,
  onNow,
  isToday,
  hereCount,
  scheduledCount,
  offCount,
  nowMinutes,
}: Props) {
  const dateLabel = date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const dayName = date.toLocaleDateString("en-US", { weekday: "long" });
  const timeStr = fmtTime(nowMinutes);
  const total = scheduledCount + offCount;
  const coverageOk = hereCount >= OPTIMAL_COVERAGE;
  const coverageWarn =
    hereCount >= MINIMUM_COVERAGE && hereCount < OPTIMAL_COVERAGE;

  const statCard = (value: number, label: string, color: string) => (
    <div
      style={{
        flex: 1,
        background: "#1a2236",
        borderRadius: 12,
        padding: "12px 8px",
        textAlign: "center",
        border: `1px solid ${color}33`,
      }}
    >
      <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }}>
        {value}
      </div>
      <div
        style={{
          fontSize: 11,
          color: "#64748b",
          marginTop: 4,
          fontWeight: 500,
        }}
      >
        {label}
      </div>
    </div>
  );

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Team label + today btn */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#22c55e",
              display: "inline-block",
              boxShadow: "0 0 0 3px rgba(34,197,94,0.2)",
            }}
          />
          <span
            style={{
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.1em",
              color: "#94a3b8",
              textTransform: "uppercase",
            }}
          >
            Fulfillment Team
          </span>
        </div>
        {!isToday && (
          <button
            onClick={onNow}
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "#f1f5f9",
              background: "#334155",
              border: "none",
              borderRadius: 8,
              padding: "5px 12px",
              cursor: "pointer",
            }}
          >
            TODAY
          </button>
        )}
      </div>

      {/* Date nav */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <button onClick={onPrev} style={navBtn}>
          ←
        </button>
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              fontSize: 24,
              fontWeight: 800,
              color: "#f1f5f9",
              letterSpacing: "-0.02em",
            }}
          >
            {dateLabel}
          </div>
          <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>
            {dayName}
          </div>
          {isToday && (
            <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>
              Simulated: {timeStr}
            </div>
          )}
        </div>
        <button onClick={onNext} style={navBtn}>
          →
        </button>
      </div>

      {/* Stat cards */}
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        {statCard(hereCount, "Here Now", "#22c55e")}
        {statCard(scheduledCount, "Scheduled", "#6366f1")}
        {statCard(offCount, "Off", "#475569")}
      </div>

      {/* Alert */}
      {!coverageOk && hereCount >= 0 && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 14px",
            background: coverageWarn
              ? "rgba(245,158,11,0.12)"
              : "rgba(239,68,68,0.12)",
            border: `1px solid ${coverageWarn ? "rgba(245,158,11,0.3)" : "rgba(239,68,68,0.3)"}`,
            borderRadius: 10,
            fontSize: 12,
            color: coverageWarn ? "#fbbf24" : "#f87171",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span>⚠</span>
          <span>
            Coverage {coverageWarn ? "below optimal" : "below threshold"} —{" "}
            {hereCount} here of {total} scheduled
          </span>
        </div>
      )}
    </div>
  );
}

const navBtn: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: "50%",
  background: "#1e293b",
  border: "1px solid #334155",
  color: "#94a3b8",
  fontSize: 16,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
