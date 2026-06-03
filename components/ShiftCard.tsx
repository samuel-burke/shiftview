"use client";

import { motion } from "framer-motion";
import {
  Employee,
  Schedule,
  StoreHours,
  AttendanceStatus,
  getShiftType,
  getMonogram,
  formatDisplayName,
  isHere,
  SHIFT_COLORS,
  fmtMinutes,
} from "../data/types";

type Props = {
  employee: Employee;
  schedule: Schedule;
  storeHours: StoreHours;
  nowMinutes: number;
  isToday: boolean;
  attendanceStatus?: AttendanceStatus;
  onClick: () => void;
};

const ATTENDANCE_BADGES: Record<AttendanceStatus, { label: string; className: string }> = {
  clocked_in:    { label: "Clocked In",    className: "bg-green-500/15 text-green-500" },
  on_break:      { label: "On Break",      className: "bg-amber-500/15 text-amber-400" },
  clocked_out:   { label: "Clocked Out",   className: "bg-slate-700/50 text-slate-400" },
  not_clocked_in:{ label: "Not Here Yet",  className: "bg-red-500/15 text-red-400" },
};

export default function ShiftCard({
  employee,
  schedule,
  storeHours,
  nowMinutes,
  isToday,
  attendanceStatus,
  onClick,
}: Props) {
  const shiftType = getShiftType(schedule.startMinutes, schedule.endMinutes, storeHours.open, storeHours.close);
  const here = isToday && isHere(schedule, nowMinutes);
  const shiftColor = shiftType ? SHIFT_COLORS[shiftType] : "#94a3b8";

  let arrivalText: string | null = null;
  if (isToday && !here && schedule.startMinutes > nowMinutes) {
    const diff = schedule.startMinutes - nowMinutes;
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    arrivalText = h > 0 ? (m > 0 ? `In ${h}h ${m}m` : `In ${h}h`) : `In ${m}m`;
  }

  // Resolve badge: prefer attendance status when we have real punch data
  let badge: { label: string; className: string } | null = null;
  if (isToday) {
    if (attendanceStatus) {
      if (attendanceStatus === "not_clocked_in") {
        // Only show "Not Here Yet" after the shift has started
        if (schedule.startMinutes <= nowMinutes) {
          badge = ATTENDANCE_BADGES.not_clocked_in;
        }
      } else {
        badge = ATTENDANCE_BADGES[attendanceStatus];
      }
    } else if (here) {
      // No punch data (demo mode or still loading) — time-based fallback
      badge = { label: "Here", className: "bg-green-500/15 text-green-500" };
    }
  }

  const isActive = badge?.label === "Clocked In" || badge?.label === "Here";

  const glowShadow = isActive
    ? `0 0 0 1px ${shiftColor}30, 0 4px 24px ${shiftColor}22, inset 0 1px 0 rgba(255,255,255,0.07)`
    : `inset 0 1px 0 rgba(255,255,255,0.04)`;

  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className="w-full text-left bg-[#12192a] border border-white/[0.08] rounded-xl px-[14px] py-3 mb-2 flex items-center gap-3 cursor-pointer transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5"
      style={{ borderLeft: `3px solid ${shiftColor}`, boxShadow: glowShadow }}
    >
      {/* Avatar */}
      <div
        className="size-[38px] rounded-full flex items-center justify-center text-xs font-bold shrink-0"
        style={{
          background: `color-mix(in srgb, ${shiftColor} 13%, transparent)`,
          border: `1.5px solid color-mix(in srgb, ${shiftColor} 33%, transparent)`,
          color: shiftColor,
        }}
      >
        {getMonogram(employee.name)}
      </div>

      {/* Name + shift type */}
      <div className="flex-1 min-w-0">
        <div className={`font-semibold text-sm truncate ${isActive ? "text-slate-100" : "text-slate-400"}`}>
          {formatDisplayName(employee.name)}
        </div>
        {shiftType && (
          <div className="text-[11px] mt-0.5 capitalize" style={{ color: shiftColor }}>
            {shiftType}
          </div>
        )}
      </div>

      {/* Right side */}
      <div className="text-right shrink-0">
        <div className="text-[11px] text-slate-400 whitespace-nowrap">
          {fmtMinutes(schedule.startMinutes)} – {fmtMinutes(schedule.endMinutes)}
        </div>
        <div className="mt-[5px] flex justify-end items-center gap-1.5">
          {arrivalText && !badge && (
            <span className="text-[10px] text-slate-400">{arrivalText}</span>
          )}
          {badge && (
            <span className={`text-[11px] font-bold px-[9px] py-0.5 rounded-md flex items-center gap-1.5 ${badge.className}`}>
              {badge.label === "Clocked In" && (
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
              )}
              {badge.label}
            </span>
          )}
        </div>
      </div>
    </motion.button>
  );
}
