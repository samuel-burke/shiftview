"use client";

import { useEffect, useState } from "react";
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
  onSave: (scheduleId: number, startMinutes: number, endMinutes: number) => Promise<void>;
  isManager: boolean;
};

function minutesToTime(m: number): string {
  if (m < 0) return "";
  return `${Math.floor(m / 60).toString().padStart(2, "0")}:${(m % 60).toString().padStart(2, "0")}`;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export default function EmployeeDrawer({
  open,
  employee,
  schedule,
  nowMinutes,
  onClose,
  onSave,
  isManager,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [startVal, setStartVal] = useState("");
  const [endVal, setEndVal] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  // Reset edit state when drawer opens or selected employee changes
  useEffect(() => {
    if (open && schedule) {
      setEditing(false);
      setStartVal(minutesToTime(schedule.startMinutes));
      setEndVal(minutesToTime(schedule.endMinutes));
      setError(null);
    }
  }, [open, schedule]);

  if (!employee || !schedule) return null;

  const shiftType = getShiftType(schedule.startMinutes);
  const here = isHere(schedule, nowMinutes);
  const scheduled = schedule.startMinutes >= 0;
  const shiftColor = shiftType ? SHIFT_COLORS[shiftType] : "#475569";
  const statusLabel = here ? "Here" : scheduled ? "Not Yet In / Off" : "Off Today";
  const statusColor = here ? "#22c55e" : "#64748b";

  async function handleSave() {
    if (!startVal || !endVal) { setError("Both times are required."); return; }
    const start = timeToMinutes(startVal);
    const end = timeToMinutes(endVal);
    if (start >= end) { setError("End time must be after start time."); return; }
    setSaving(true);
    setError(null);
    try {
      await onSave(schedule.id, start, end);
      setEditing(false);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save shift");
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkOff() {
    setSaving(true);
    setError(null);
    try {
      await onSave(schedule.id, -1, -1);
      setEditing(false);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save shift");
    } finally {
      setSaving(false);
    }
  }

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
        {/* Drag handle */}
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 4px" }}>
          <div style={{ width: 40, height: 4, borderRadius: 2, background: "#334155" }} />
        </div>

        <div style={{ padding: "8px 24px 44px" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
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
                <div style={{ fontSize: 18, fontWeight: 700, color: "#f1f5f9" }}>
                  {employee.name}
                </div>
                <div style={{ fontSize: 12, marginTop: 3 }}>
                  {shiftType && (
                    <span style={{ color: shiftColor, textTransform: "capitalize", marginRight: 6 }}>
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

          {editing ? (
            /* ── Edit mode ── */
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                { label: "Start time", val: startVal, set: setStartVal },
                { label: "End time",   val: endVal,   set: setEndVal   },
              ].map(({ label, val, set }) => (
                <div key={label}>
                  <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                    {label}
                  </div>
                  <input
                    type="time"
                    value={val}
                    onChange={(e) => { set(e.target.value); setError(null); }}
                    style={{
                      width: "100%",
                      background: "#1a2236",
                      border: "1px solid #334155",
                      borderRadius: 10,
                      padding: "12px 14px",
                      color: "#f1f5f9",
                      fontSize: 16,
                      colorScheme: "dark",
                    }}
                  />
                </div>
              ))}

              {error && (
                <div style={{ fontSize: 12, color: "#f87171", textAlign: "center" }}>{error}</div>
              )}

              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: "14px 0",
                  borderRadius: 12,
                  background: "linear-gradient(90deg, #3b82f6, #8b5cf6)",
                  border: "none",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: 14,
                  cursor: "pointer",
                  opacity: saving ? 0.7 : 1,
                  marginTop: 4,
                }}
              >
                {saving ? "Saving…" : "Save Shift"}
              </button>

              <button
                onClick={handleMarkOff}
                disabled={saving}
                style={{
                  padding: "14px 0",
                  borderRadius: 12,
                  background: "transparent",
                  border: "1px solid #334155",
                  color: "#f87171",
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: "pointer",
                  opacity: saving ? 0.7 : 1,
                }}
              >
                Mark as Off
              </button>

              <button
                onClick={() => { setEditing(false); setError(null); }}
                disabled={saving}
                style={{
                  padding: "14px 0",
                  borderRadius: 12,
                  background: "transparent",
                  border: "none",
                  color: "#475569",
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            /* ── View mode ── */
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 24 }}>
                {[
                  { label: "Start",      value: scheduled ? fmtMinutes(schedule.startMinutes) : "—" },
                  { label: "End",        value: scheduled ? fmtMinutes(schedule.endMinutes) : "—" },
                  { label: "Shift Type", value: shiftType ? shiftType.charAt(0).toUpperCase() + shiftType.slice(1) : "Off" },
                  { label: "Status",     value: statusLabel },
                ].map(({ label, value }) => (
                  <div key={label} style={{ background: "#1a2236", borderRadius: 12, padding: "12px 14px" }}>
                    <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                      {label}
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "#f1f5f9" }}>{value}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                {isManager && (
                  <button
                    onClick={() => setEditing(true)}
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
                    {scheduled ? "Edit Shift" : "Add Shift"}
                  </button>
                )}
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
            </>
          )}
        </div>
      </div>
    </>
  );
}
