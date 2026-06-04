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
  clocked_in:     { label: "Clocked In",    className: "bg-green-500/15 text-green-500" },
  on_break:       { label: "On Break",      className: "bg-amber-500/15 text-amber-400" },
  clocked_out:    { label: "Clocked Out",   className: "bg-slate-700/50 text-slate-400" },
  not_clocked_in: { label: "Not Here Yet",  className: "bg-red-500/15 text-red-400" },
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

  let badge: { label: string; className: string } | null = null;
  if (isToday) {
    if (attendanceStatus) {
      if (attendanceStatus === "not_clocked_in") {
        if (schedule.startMinutes <= nowMinutes) {
          badge = ATTENDANCE_BADGES.not_clocked_in;
        }
      } else {
        badge = ATTENDANCE_BADGES[attendanceStatus];
      }
    } else if (here) {
      badge = { label: "Here", className: "bg-green-500/15 text-green-500" };
    }
  }

  const isActive = badge?.label === "Clocked In" || badge?.label === "Here";
  const isOnBreak = badge?.label === "On Break";

  const glowShadow = `0 0 18px ${shiftColor}20, inset 0 1px 0 rgba(255,255,255,0.04)`;

  const shiftTimeLabel = `${fmtMinutes(schedule.startMinutes)} to ${fmtMinutes(schedule.endMinutes)}`;
  const cardAriaLabel = `${formatDisplayName(employee.name)}, ${shiftType ?? "shift"}, ${shiftTimeLabel}${badge ? `, ${badge.label}` : ""}`;

  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      whileHover={{ y: -1, boxShadow: `0 4px 24px ${shiftColor}30` }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      aria-label={cardAriaLabel}
      className="w-full text-left bg-card border border-white/[0.08] rounded-xl px-[14px] py-3 mb-2 flex items-center gap-3 cursor-pointer"
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
        <div className="text-xs text-slate-400 whitespace-nowrap">
          {fmtMinutes(schedule.startMinutes)} – {fmtMinutes(schedule.endMinutes)}
        </div>
        <div className="mt-[5px] flex justify-end items-center gap-1.5">
          {arrivalText && !badge && (
            <span className="text-xs text-slate-400">{arrivalText}</span>
          )}
          {badge && (
            <span className={`text-[11px] font-bold px-[9px] py-1 rounded-md flex items-center gap-1.5 ${badge.className}`}>
              {(badge.label === "Clocked In" || badge.label === "Here") && (
                <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
              )}
              {badge.label === "On Break" && (
                <motion.span
                  animate={{ opacity: [1, 0.4, 1] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                  className="relative flex h-2 w-2 shrink-0 rounded-full bg-amber-400"
                />
              )}
              {badge.label}
            </span>
          )}
        </div>
      </div>
    </motion.button>
  );
}
