"use client";

import { useEffect } from "react";
import {
  Employee,
  Schedule,
  getShiftType,
  isHere,
  SHIFT_COLORS,
  fmtMinutes,
} from "../data/types";

type Props = {
  open: boolean;
  employee: Employee | null;
  schedule: Schedule | null;
  nowMinutes: number;
  onClose: () => void;
};

export default function EmployeeDrawer({
  open,
  employee,
  schedule,
  nowMinutes,
  onClose,
}: Props) {
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!employee || !schedule) return null;

  const shiftType = getShiftType(schedule.startMinutes);
  const here = isHere(schedule, nowMinutes);
  const scheduled = schedule.startMinutes >= 0;
  const shiftColor = shiftType ? SHIFT_COLORS[shiftType] : "#475569";

  const statusLabel = here
    ? "Here"
    : scheduled
      ? "Not Yet In / Off"
      : "Off Today";
  const statusColor = here ? "#22c55e" : "#64748b";

  return (
    <>
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
      <div
        style={{
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
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            padding: "12px 0 4px",
          }}
        >
          <div
            style={{
              width: 40,
              height: 4,
              borderRadius: 2,
              background: "#334155",
            }}
          />
        </div>
        <div style={{ padding: "8px 24px 44px" }}>
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 24,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 14,
                  background: `${shiftColor}22`,
                  border: `2px solid ${shiftColor}55`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 16,
                  fontWeight: 800,
                  color: shiftColor,
                }}
              >
                {employee.avatar}
              </div>
              <div>
                <div
                  style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9" }}
                >
                  {employee.name}
                </div>
                <div style={{ fontSize: 12, marginTop: 3 }}>
                  {shiftType && (
                    <span
                      style={{
                        color: shiftColor,
                        textTransform: "capitalize",
                        marginRight: 6,
                      }}
                    >
                      {shiftType}
                    </span>
                  )}
                  <span style={{ color: statusColor }}>· {statusLabel}</span>
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                background: "#1e293b",
                border: "none",
                color: "#64748b",
                fontSize: 16,
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          </div>

          {/* Stats */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              marginBottom: 24,
            }}
          >
            {[
              {
                label: "Start",
                value: scheduled ? fmtMinutes(schedule.startMinutes) : "—",
              },
              {
                label: "End",
                value: scheduled ? fmtMinutes(schedule.endMinutes) : "—",
              },
              {
                label: "Shift Type",
                value: shiftType
                  ? shiftType.charAt(0).toUpperCase() + shiftType.slice(1)
                  : "Off",
              },
              { label: "Status", value: statusLabel },
            ].map(({ label, value }) => (
              <div
                key={label}
                style={{
                  background: "#1a2236",
                  borderRadius: 12,
                  padding: "12px 14px",
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: "#475569",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    marginBottom: 4,
                  }}
                >
                  {label}
                </div>
                <div
                  style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9" }}
                >
                  {value}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              style={{
                flex: 1,
                padding: "14px 0",
                borderRadius: 12,
                background: "#3b82f6",
                border: "none",
                color: "#fff",
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Edit Shift
            </button>
            <button
              style={{
                flex: 1,
                padding: "14px 0",
                borderRadius: 12,
                background: "#1e293b",
                border: "1px solid #334155",
                color: "#94a3b8",
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Message
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
