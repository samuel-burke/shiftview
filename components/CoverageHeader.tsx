"use client";

import { useState } from "react";
import { CoverageStatus } from "../data/types";
import DatePickerSheet from "./DatePickerSheet";

type Props = {
  date: Date;
  today: Date;
  onPrev: () => void;
  onNext: () => void;
  onNow: () => void;
  onSignOut?: () => void;
  onSignIn?: () => void;
  onDateSelect: (date: Date) => void;
  isToday: boolean;
  hereCount: number;
  scheduledCount: number;
  offCount: number;
  nowMinutes: number;
  coverageStatus: CoverageStatus;
  isDemo: boolean;
  loading?: boolean;
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
  today,
  onPrev,
  onNext,
  onNow,
  onSignOut,
  onSignIn,
  onDateSelect,
  isToday,
  hereCount,
  scheduledCount,
  offCount,
  nowMinutes,
  coverageStatus,
  isDemo,
  loading = false,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const dateLabel = date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const dayName = date.toLocaleDateString("en-US", { weekday: "long" });
  const timeStr = fmtTime(nowMinutes);

  const isPast = date < today && !isToday;
  const isFuture = date > today && !isToday;

  const alertConfig = (() => {
    if (isPast)
      return {
        icon: "📅",
        message: "Viewing past schedule",
        bg: "rgba(71,85,105,0.12)",
        border: "rgba(71,85,105,0.3)",
        text: "#94a3b8",
      };
    if (isFuture)
      return {
        icon: "📅",
        message: "Viewing future schedule",
        bg: "rgba(71,85,105,0.12)",
        border: "rgba(71,85,105,0.3)",
        text: "#94a3b8",
      };
    if (coverageStatus === "closed")
      return {
        icon: "🔒",
        message: "Store closed",
        bg: "rgba(71,85,105,0.12)",
        border: "rgba(71,85,105,0.3)",
        text: "#94a3b8",
      };
    if (coverageStatus === "critical")
      return {
        icon: "⚠",
        message: `Coverage below minimum — ${hereCount} here now`,
        bg: "rgba(239,68,68,0.12)",
        border: "rgba(239,68,68,0.3)",
        text: "#f87171",
      };
    if (coverageStatus === "low")
      return {
        icon: "⚠",
        message: `Coverage below optimal — ${hereCount} here now`,
        bg: "rgba(245,158,11,0.12)",
        border: "rgba(245,158,11,0.3)",
        text: "#fbbf24",
      };
    return null;
  })();

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
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
          <div className="skeleton" style={{ height: 28, width: 32, borderRadius: 6 }} />
        </div>
      ) : (
        <div style={{ fontSize: 28, fontWeight: 800, color, lineHeight: 1 }}>
          {value}
        </div>
      )}
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
        {/* Left — brand */}
        <span
          style={{
            fontSize: 24,
            fontWeight: 800,
            color: "#f1f5f9",
            letterSpacing: "-0.02em",
          }}
        >
          Shift
          <span
            style={{
              background: "linear-gradient(90deg, #3b82f6, #8b5cf6)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            View
          </span>
        </span>

        {/* Right — actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {!isToday && (
            <button
              onClick={onNow}
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#f1f5f9",
                background: "#334155",
                border: "none",
                borderRadius: 10,
                padding: "8px 16px",
                cursor: "pointer",
              }}
            >
              TODAY
            </button>
          )}
          {onSignOut && (
            <button
              onClick={onSignOut}
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#475569",
                background: "transparent",
                border: "1px solid #1e293b",
                borderRadius: 10,
                padding: "8px 16px",
                cursor: "pointer",
              }}
            >
              Sign Out
            </button>
          )}
          {onSignIn && (
            <button
              onClick={onSignIn}
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: "#3b82f6",
                background: "transparent",
                border: "1px solid #1e293b",
                borderRadius: 10,
                padding: "8px 16px",
                cursor: "pointer",
              }}
            >
              Sign In
            </button>
          )}
        </div>
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
        <button
          onClick={() => setPickerOpen(true)}
          style={{ textAlign: "center", background: "none", border: "none", cursor: "pointer", padding: 0 }}
        >
          <div
            style={{
              fontSize: 24,
              fontWeight: 800,
              color: "#f1f5f9",
              letterSpacing: "-0.02em",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            {dateLabel}
            <span style={{ fontSize: 13, color: "#3b82f6", fontWeight: 400 }}>▾</span>
          </div>
          <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>
            {dayName}
          </div>
          {isToday && (
            <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>
              Live: {timeStr}
            </div>
          )}
        </button>
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
      {alertConfig && !loading && (
        <div
          style={{
            marginTop: 12,
            padding: "10px 14px",
            background: alertConfig.bg,
            border: `1px solid ${alertConfig.border}`,
            borderRadius: 10,
            fontSize: 12,
            color: alertConfig.text,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span>{alertConfig.icon}</span>
          <span>{alertConfig.message}</span>
        </div>
      )}

      <DatePickerSheet
        open={pickerOpen}
        selected={date}
        today={today}
        onSelect={onDateSelect}
        onClose={() => setPickerOpen(false)}
      />
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
