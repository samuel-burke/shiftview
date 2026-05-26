"use client";

import { useState, useEffect } from "react";
import { useIsDesktop } from "../hooks/useIsDesktop";

type Props = {
  open: boolean;
  selected: Date;
  today: Date;
  onSelect: (date: Date) => void;
  onClose: () => void;
};

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function getCalendarDays(year: number, month: number): (Date | null)[] {
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days: (Date | null)[] = Array(firstDow).fill(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(new Date(year, month, d));
  return days;
}

export default function DatePickerSheet({ open, selected, today, onSelect, onClose }: Props) {
  const isDesktop = useIsDesktop();
  const [viewYear, setViewYear] = useState(selected.getFullYear());
  const [viewMonth, setViewMonth] = useState(selected.getMonth());

  // Sync view when selected date changes externally
  useEffect(() => {
    if (open) {
      setViewYear(selected.getFullYear());
      setViewMonth(selected.getMonth());
    }
  }, [open, selected]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const days = getCalendarDays(viewYear, viewMonth);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          zIndex: 40,
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.25s",
        }}
      />

      {/* Sheet */}
      <div
        style={isDesktop ? {
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: open ? "translate(-50%, -50%)" : "translate(-50%, -48%)",
          opacity: open ? 1 : 0,
          transition: "opacity 0.2s, transform 0.2s",
          pointerEvents: open ? "auto" : "none",
          zIndex: 50,
          background: "#0f172a",
          border: "1px solid #1e293b",
          borderRadius: 20,
          width: 360,
          padding: "24px 24px 28px",
        } : {
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          background: "#0f172a",
          borderTop: "1px solid #1e293b",
          borderRadius: "24px 24px 0 0",
          transform: open ? "translateY(0)" : "translateY(100%)",
          transition: "transform 0.3s cubic-bezier(0.16,1,0.3,1)",
          maxWidth: 480,
          margin: "0 auto",
          padding: "12px 24px 44px",
        }}
      >
        {/* Drag handle (mobile only) */}
        {!isDesktop && (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: "#334155" }} />
          </div>
        )}

        {/* Month nav */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <button onClick={prevMonth} style={navBtn}>←</button>
          <span style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9" }}>
            {MONTHS[viewMonth]} {viewYear}
          </span>
          <button onClick={nextMonth} style={navBtn}>→</button>
        </div>

        {/* Weekday headers */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", marginBottom: 8 }}>
          {WEEKDAYS.map(d => (
            <div key={d} style={{ textAlign: "center", fontSize: 11, fontWeight: 600, color: "#475569", paddingBottom: 6 }}>
              {d}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "4px 0" }}>
          {days.map((day, i) => {
            if (!day) return <div key={i} />;

            const isSelected = sameDay(day, selected);
            const isToday_ = sameDay(day, today);

            return (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <button
                  onClick={() => { onSelect(day); onClose(); }}
                  style={{
                    width: 38,
                    height: 38,
                    borderRadius: "50%",
                    border: "none",
                    cursor: "pointer",
                    fontSize: 14,
                    fontWeight: isSelected || isToday_ ? 700 : 400,
                    color: isSelected ? "#fff" : isToday_ ? "#3b82f6" : "#94a3b8",
                    background: isSelected
                      ? "linear-gradient(135deg, #3b82f6, #8b5cf6)"
                      : "transparent",
                  }}
                >
                  {day.getDate()}
                </button>
                {/* Today dot */}
                {isToday_ && !isSelected && (
                  <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#3b82f6" }} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
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
