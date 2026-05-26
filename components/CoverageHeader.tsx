"use client";

import { useState, useRef, useEffect } from "react";
import { CoverageStatus } from "../data/types";
import DatePickerSheet from "./DatePickerSheet";
import { useIsDesktop } from "../hooks/useIsDesktop";

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
  nowMinutes,
  coverageStatus,
  isDemo,
  loading = false,
}: Props) {
  const isDesktop = useIsDesktop();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [barHeight, setBarHeight] = useState(0);
  const topBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isDesktop || !topBarRef.current) return;
    const ro = new ResizeObserver(() => {
      if (topBarRef.current) setBarHeight(topBarRef.current.offsetHeight);
    });
    ro.observe(topBarRef.current);
    setBarHeight(topBarRef.current.offsetHeight);
    return () => ro.disconnect();
  }, [isDesktop]);

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
    if (isPast || isFuture)
      return { icon: "📅", message: isPast ? "Viewing past schedule" : "Viewing future schedule", bg: "rgba(71,85,105,0.12)", border: "rgba(71,85,105,0.3)", text: "#94a3b8" };
    if (coverageStatus === "closed")
      return { icon: "🔒", message: "Store closed", bg: "rgba(71,85,105,0.12)", border: "rgba(71,85,105,0.3)", text: "#94a3b8" };
    if (coverageStatus === "critical")
      return { icon: "⚠", message: `Coverage below minimum — ${hereCount} here now`, bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.3)", text: "#f87171" };
    if (coverageStatus === "low")
      return { icon: "⚠", message: `Coverage below optimal — ${hereCount} here now`, bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.3)", text: "#fbbf24" };
    return null;
  })();

  const dateNav = (
    <div style={{ display: "flex", alignItems: "center", gap: isDesktop ? 16 : 0, justifyContent: isDesktop ? undefined : "space-between" }}>
      <button onClick={onPrev} aria-label="Previous day" style={navBtn(isDesktop)}>←</button>
      <button
        onClick={() => setPickerOpen(true)}
        style={{ textAlign: "center", background: "none", border: "none", cursor: "pointer", padding: isDesktop ? "0 8px" : 0 }}
      >
        <div style={{ fontSize: isDesktop ? 18 : 24, fontWeight: 800, color: "#f1f5f9", letterSpacing: "-0.02em", display: "flex", alignItems: "center", gap: 6 }}>
          {dateLabel}
          <span style={{ fontSize: 13, color: "#3b82f6", fontWeight: 400 }}>▾</span>
        </div>
        <div style={{ fontSize: 13, color: "#64748b", marginTop: 2 }}>
          {dayName}
          {isToday && isDesktop && <span style={{ marginLeft: 8, color: "#475569" }}>· {timeStr}</span>}
        </div>
        {isToday && !isDesktop && (
          <div style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>Live: {timeStr}</div>
        )}
      </button>
      <button onClick={onNext} aria-label="Next day" style={navBtn(isDesktop)}>→</button>
    </div>
  );

  // ── Desktop layout ──────────────────────────────────────────────────────────
  if (isDesktop) {
    return (
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            background: "#0a1628",
            borderBottom: "1px solid #1e293b",
            padding: "14px 24px",
            display: "flex",
            alignItems: "center",
            gap: 24,
          }}
        >
          {/* Brand */}
          <span style={{ fontSize: 22, fontWeight: 800, color: "#f1f5f9", letterSpacing: "-0.02em", flexShrink: 0 }}>
            Shift
            <span style={{ background: "linear-gradient(90deg, #3b82f6, #8b5cf6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              View
            </span>
          </span>

          {/* Date nav — centered */}
          <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
            {dateNav}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {!isToday && (
              <button onClick={onNow} style={actionBtn}>TODAY</button>
            )}
            {onSignOut && <button onClick={onSignOut} style={{ ...actionBtn, color: "#475569" }}>Sign Out</button>}
            {onSignIn && <button onClick={onSignIn} style={{ ...actionBtn, color: "#3b82f6" }}>Sign In</button>}
          </div>
        </div>

        {alertConfig && !loading && (
          <div style={{ margin: "12px 24px 0", padding: "10px 14px", background: alertConfig.bg, border: `1px solid ${alertConfig.border}`, borderRadius: 10, fontSize: 12, color: alertConfig.text, display: "flex", alignItems: "center", gap: 8 }}>
            <span>{alertConfig.icon}</span>
            <span>{alertConfig.message}</span>
          </div>
        )}

        <DatePickerSheet open={pickerOpen} selected={date} today={today} onSelect={onDateSelect} onClose={() => setPickerOpen(false)} />
      </div>
    );
  }

  // ── Mobile layout ───────────────────────────────────────────────────────────
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        ref={topBarRef}
        style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 30, background: "#0a1628", borderBottom: "1px solid #1e293b", maxWidth: 480, margin: "0 auto", padding: "calc(env(safe-area-inset-top) + 12px) 16px 12px" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <span style={{ fontSize: 24, fontWeight: 800, color: "#f1f5f9", letterSpacing: "-0.02em" }}>
            Shift
            <span style={{ background: "linear-gradient(90deg, #3b82f6, #8b5cf6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>View</span>
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {!isToday && (
              <button onClick={onNow} style={{ fontSize: 13, fontWeight: 700, color: "#f1f5f9", background: "#334155", border: "none", borderRadius: 10, padding: "8px 16px", cursor: "pointer" }}>TODAY</button>
            )}
            {onSignOut && (
              <button onClick={onSignOut} style={{ fontSize: 13, fontWeight: 700, color: "#475569", background: "transparent", border: "1px solid #1e293b", borderRadius: 10, padding: "8px 16px", cursor: "pointer" }}>Sign Out</button>
            )}
            {onSignIn && (
              <button onClick={onSignIn} style={{ fontSize: 13, fontWeight: 700, color: "#3b82f6", background: "transparent", border: "1px solid #1e293b", borderRadius: 10, padding: "8px 16px", cursor: "pointer" }}>Sign In</button>
            )}
          </div>
        </div>
        <div style={{ marginBottom: 4 }}>{dateNav}</div>
      </div>

      <div style={{ height: barHeight }} />

      {alertConfig && !loading && (
        <div style={{ marginTop: 12, padding: "10px 14px", background: alertConfig.bg, border: `1px solid ${alertConfig.border}`, borderRadius: 10, fontSize: 12, color: alertConfig.text, display: "flex", alignItems: "center", gap: 8 }}>
          <span>{alertConfig.icon}</span>
          <span>{alertConfig.message}</span>
        </div>
      )}

      <DatePickerSheet open={pickerOpen} selected={date} today={today} onSelect={onDateSelect} onClose={() => setPickerOpen(false)} />
    </div>
  );
}

const navBtn = (isDesktop: boolean): React.CSSProperties => ({
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
  flexShrink: 0,
});

const actionBtn: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "#f1f5f9",
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 10,
  padding: "8px 14px",
  cursor: "pointer",
};
