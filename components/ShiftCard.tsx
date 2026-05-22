"use client";

import {
  Employee,
  Schedule,
  ShiftType,
  getShiftType,
  isHere,
  SHIFT_COLORS,
  fmtMinutes,
} from "../data/types";

type Props = {
  employee: Employee;
  schedule: Schedule;
  nowMinutes: number;
  isToday: boolean;
  onClick: () => void;
};

export default function ShiftCard({
  employee,
  schedule,
  nowMinutes,
  isToday,
  onClick,
}: Props) {
  const shiftType = getShiftType(schedule.startMinutes);
  const scheduled = schedule.startMinutes >= 0;
  const here = isToday && isHere(schedule, nowMinutes);
  const shiftColor = shiftType ? SHIFT_COLORS[shiftType] : "#475569";

  // Arrival countdown
  let arrivalText: string | null = null;
  if (isToday && scheduled && !here && schedule.startMinutes > nowMinutes) {
    const diff = schedule.startMinutes - nowMinutes;
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    arrivalText = h > 0 ? (m > 0 ? `In ${h}h ${m}m` : `In ${h}h`) : `In ${m}m`;
  }

  return (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        background: "#111827",
        border: "1px solid #1e293b",
        borderLeft: scheduled ? `3px solid ${shiftColor}` : "3px solid #1e293b",
        borderRadius: 12,
        padding: "12px 14px",
        marginBottom: 8,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 12,
        transition: "background 0.15s",
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = "#1a2236")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "#111827")}
    >
      {/* Avatar */}
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: "50%",
          background: scheduled ? `${shiftColor}22` : "#1e293b",
          border: `1.5px solid ${scheduled ? shiftColor + "55" : "#334155"}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 700,
          color: scheduled ? shiftColor : "#475569",
          flexShrink: 0,
        }}
      >
        {employee.avatar}
      </div>

      {/* Name + shift type */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontWeight: 600,
            fontSize: 14,
            color: here ? "#f1f5f9" : "#64748b",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {employee.name}
        </div>
        {shiftType && (
          <div
            style={{
              fontSize: 11,
              color: shiftColor,
              marginTop: 2,
              textTransform: "capitalize",
            }}
          >
            {shiftType}
          </div>
        )}
      </div>

      {/* Right side */}
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        {scheduled ? (
          <div style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap" }}>
            {fmtMinutes(schedule.startMinutes)} –{" "}
            {fmtMinutes(schedule.endMinutes)}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: "#334155" }}>Off</div>
        )}
        <div
          style={{
            marginTop: 5,
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            gap: 6,
          }}
        >
          {arrivalText && (
            <span style={{ fontSize: 10, color: "#94a3b8" }}>
              {arrivalText}
            </span>
          )}
          {here && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "2px 9px",
                borderRadius: 6,
                background: "rgba(34,197,94,0.15)",
                color: "#22c55e",
              }}
            >
              Here
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
