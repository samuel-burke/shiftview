"use client";

import { useEffect, useState } from "react";
import { useIsDesktop } from "../hooks/useIsDesktop";
import {
  Employee,
  Schedule,
  StoreHours,
  getShiftType,
  getMonogram,
  isHere,
  SHIFT_COLORS,
  fmtMinutes,
} from "../data/types";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type Props = {
  open: boolean;
  employee: Employee | null;
  schedule: Schedule | null;
  storeHours: StoreHours;
  nowMinutes: number;
  isToday: boolean;
  onClose: () => void;
  onSave: (scheduleId: number, startMinutes: number, endMinutes: number) => Promise<void>;
  onCreate: (employeeId: number, startMinutes: number, endMinutes: number) => Promise<void>;
  onMarkOff: (scheduleId: number) => Promise<void>;
  onResendInvite?: (email: string) => Promise<void>;
  isManager: boolean;
  date?: string;
  unavailableDays?: number[];
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
  storeHours,
  nowMinutes,
  isToday,
  onClose,
  onSave,
  onCreate,
  onMarkOff,
  onResendInvite,
  isManager,
  date,
  unavailableDays,
}: Props) {
  const isDesktop = useIsDesktop();
  const [editing, setEditing] = useState(false);
  const [startVal, setStartVal] = useState("");
  const [endVal, setEndVal] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteSent, setInviteSent] = useState(false);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  useEffect(() => {
    if (open) {
      setEditing(!schedule);
      setStartVal(schedule ? minutesToTime(schedule.startMinutes) : "09:00");
      setEndVal(schedule ? minutesToTime(schedule.endMinutes) : "17:00");
      setError(null);
      setInviteSent(false);
    }
  }, [open, schedule]);

  if (!employee) return null;

  const dayOfWeek = date
    ? new Date(date + "T12:00:00").getDay()
    : new Date().getDay();

  const shiftType = schedule ? getShiftType(schedule.startMinutes, schedule.endMinutes, storeHours.open, storeHours.close) : null;
  const here = isToday && !!schedule && isHere(schedule, nowMinutes);
  const shiftColor = shiftType ? SHIFT_COLORS[shiftType] : "#94a3b8";
  const statusLabel = !schedule ? "Off" : here ? "Here" : isToday ? "Not Yet In / Off" : "Scheduled";
  const statusColor = here ? "#22c55e" : "#94a3b8";

  async function handleSave() {
    if (!employee) return;
    if (!startVal || !endVal) { setError("Both times are required."); return; }
    const start = timeToMinutes(startVal);
    const end = timeToMinutes(endVal);
    if (start >= end) { setError("End time must be after start time."); return; }
    setSaving(true);
    setError(null);
    try {
      if (schedule) {
        await onSave(schedule.id, start, end);
      } else {
        await onCreate(employee.id, start, end);
      }
      setEditing(false);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save shift");
    } finally {
      setSaving(false);
    }
  }

  async function handleMarkOff() {
    if (!schedule) return;
    setSaving(true);
    setError(null);
    try {
      await onMarkOff(schedule.id);
      setEditing(false);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to mark as off");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 bg-black/60 z-40 transition-opacity duration-[250ms] ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
      />
      <div
        data-testid="employee-drawer"
        className={`fixed z-50 bg-slate-900 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isDesktop
            ? `inset-y-0 right-0 w-[420px] border-l border-slate-800 overflow-y-auto ${open ? "translate-x-0" : "translate-x-full"}`
            : `bottom-0 left-0 right-0 border-t border-slate-800 rounded-t-3xl max-w-[480px] mx-auto ${open ? "translate-y-0" : "translate-y-full"}`
        }`}
      >
        {!isDesktop && (
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-10 h-1 rounded-full bg-slate-700" />
          </div>
        )}

        <div className={isDesktop ? "p-7" : "px-6 pt-2 pb-11"}>
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3.5">
              <div
                className="size-[52px] rounded-[14px] flex items-center justify-center text-base font-extrabold"
                style={{
                  background: `${shiftColor}22`,
                  border: `2px solid ${shiftColor}55`,
                  color: shiftColor,
                }}
              >
                {getMonogram(employee.name)}
              </div>
              <div>
                <div className="text-lg font-bold text-slate-100">{employee.name}</div>
                <div className="text-xs mt-[3px]">
                  {shiftType && (
                    <span className="capitalize mr-1.5" style={{ color: shiftColor }}>{shiftType}</span>
                  )}
                  <span style={{ color: statusColor }}>· {statusLabel}</span>
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="size-8 rounded-full bg-slate-800 border-none text-slate-400 text-base cursor-pointer flex items-center justify-center"
            >
              ✕
            </button>
          </div>

          {unavailableDays?.includes(dayOfWeek) && (
            <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2 mb-3 text-xs text-amber-400">
              ⚠ Usually unavailable on {DAY_NAMES[dayOfWeek]}s
            </div>
          )}

          {editing ? (
            <div className="flex flex-col gap-3">
              {[
                { label: "Start time", val: startVal, set: setStartVal },
                { label: "End time",   val: endVal,   set: setEndVal   },
              ].map(({ label, val, set }) => (
                <div key={label}>
                  <div className="text-[11px] text-slate-400 uppercase tracking-[0.08em] mb-1.5">
                    {label}
                  </div>
                  <input
                    type="time"
                    value={val}
                    onChange={(e) => { set(e.target.value); setError(null); }}
                    className="w-full bg-card border border-slate-700 rounded-[10px] px-[14px] py-3 text-slate-100 text-base [color-scheme:dark]"
                  />
                </div>
              ))}

              {error && (
                <div className="text-xs text-red-400 text-center">{error}</div>
              )}

              <button
                onClick={handleSave}
                disabled={saving}
                className={`py-[14px] rounded-xl mt-1 bg-gradient-to-r from-blue-500 to-violet-500 border-none text-white font-bold text-sm cursor-pointer transition-opacity ${saving ? "opacity-70" : "opacity-100"}`}
              >
                {saving ? "Saving…" : "Save Shift"}
              </button>

              {schedule && (
                <button
                  onClick={handleMarkOff}
                  disabled={saving}
                  className={`py-[14px] rounded-xl bg-transparent border border-slate-700 text-red-400 font-semibold text-sm cursor-pointer transition-opacity ${saving ? "opacity-70" : "opacity-100"}`}
                >
                  Mark as Off
                </button>
              )}

              <button
                onClick={() => { setEditing(false); setError(null); }}
                disabled={saving}
                className="py-[14px] rounded-xl bg-transparent border-none text-slate-400 font-semibold text-sm cursor-pointer"
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2.5 mb-6">
                {[
                  { label: "Start",      value: schedule ? fmtMinutes(schedule.startMinutes) : "—" },
                  { label: "End",        value: schedule ? fmtMinutes(schedule.endMinutes) : "—" },
                  { label: "Shift Type", value: shiftType ? shiftType.charAt(0).toUpperCase() + shiftType.slice(1) : "—" },
                  { label: "Status",     value: statusLabel },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-card rounded-xl px-[14px] py-3">
                    <div className="text-[10px] text-slate-400 uppercase tracking-[0.08em] mb-1">{label}</div>
                    <div className="text-sm font-semibold text-slate-100">{value}</div>
                  </div>
                ))}
              </div>

              <div className="flex gap-2.5">
                {isManager && (
                  <button
                    onClick={() => setEditing(true)}
                    className="flex-1 py-[14px] rounded-xl bg-blue-500 border-none text-white font-bold text-sm cursor-pointer"
                  >
                    Edit Shift
                  </button>
                )}
                <button
                  className="flex-1 py-[14px] rounded-xl bg-slate-800 border border-slate-700 text-slate-400 font-semibold text-sm cursor-pointer"
                >
                  Message
                </button>
              </div>

              {isManager && onResendInvite && !employee.user_id && employee.email && (
                <button
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await onResendInvite(employee.email!);
                      setInviteSent(true);
                    } catch {
                      setError("Failed to resend invite");
                    } finally {
                      setSaving(false);
                    }
                  }}
                  disabled={saving || inviteSent}
                  className={`w-full mt-2.5 py-[14px] rounded-xl bg-transparent border border-dashed border-slate-700 font-semibold text-sm cursor-pointer transition-colors ${inviteSent ? "text-green-500 border-green-900" : "text-slate-400"}`}
                >
                  {inviteSent ? "Invite sent ✓" : saving ? "Sending…" : "Resend Invite"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
