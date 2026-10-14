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
import { ShiftIcon } from "./ShiftIcons";
import { shiftWindowOn } from "@/lib/shift-times";
import { markColor, tint } from "../lib/theme-colors";

type Props = {
  employee: Employee;
  schedule: Schedule;
  storeHours: StoreHours;
  nowMinutes: number;
  isToday: boolean;
  // The store-local day being viewed; a shift from the day before (an
  // overnight shift) is placed relative to it.
  dayKey?: string;
  attendanceStatus?: AttendanceStatus;
  onClick: () => void;
};

const ATTENDANCE_BADGES: Record<AttendanceStatus, { label: string; className: string }> = {
  clocked_in:     { label: "Clocked In",    className: "bg-ok/15 text-ok-fg" },
  on_break:       { label: "On Break",      className: "bg-warning/15 text-warning-fg" },
  clocked_out:    { label: "Clocked Out",   className: "bg-fill-strong/50 text-fg-muted" },
  not_clocked_in: { label: "Not Here Yet",  className: "bg-danger/15 text-danger-fg" },
};

export default function ShiftCard({
  employee,
  schedule,
  storeHours,
  nowMinutes,
  isToday,
  dayKey,
  attendanceStatus,
  onClick,
}: Props) {
  const fromPrevDay = !!dayKey && !!schedule.date && schedule.date.slice(0, 10) < dayKey;
  const windowStart = dayKey && schedule.date ? shiftWindowOn(schedule, dayKey).start : schedule.startMinutes;
  const isWalkIn = schedule.startMinutes < 0;
  const shiftType = isWalkIn ? null : getShiftType(schedule.startMinutes, schedule.endMinutes, storeHours.open, storeHours.close);
  const here = isToday && !isWalkIn && isHere(schedule, nowMinutes, dayKey);
  const shiftColor = shiftType ? SHIFT_COLORS[shiftType] : "var(--status-muted)";

  let arrivalText: string | null = null;
  if (!isWalkIn && isToday && !here && windowStart > nowMinutes) {
    const diff = windowStart - nowMinutes;
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    arrivalText = h > 0 ? (m > 0 ? `In ${h}h ${m}m` : `In ${h}h`) : `In ${m}m`;
  }

  let badge: { label: string; className: string } | null = null;
  if (isToday) {
    if (attendanceStatus) {
      if (attendanceStatus === "not_clocked_in") {
        if (!isWalkIn && windowStart <= nowMinutes) {
          badge = ATTENDANCE_BADGES.not_clocked_in;
        }
      } else {
        badge = ATTENDANCE_BADGES[attendanceStatus];
      }
    } else if (here) {
      badge = { label: "Here", className: "bg-ok/15 text-ok-fg" };
    }
  }

  const isActive = badge?.label === "Clocked In" || badge?.label === "Here";

  const glowShadow = `0 0 18px ${tint(shiftColor, 13)}, var(--shadow-card)`;

  const shiftTimeLabel = `${fromPrevDay ? "from yesterday, " : ""}${fmtMinutes(schedule.startMinutes)} to ${fmtMinutes(schedule.endMinutes)}`;
  const cardAriaLabel = `${formatDisplayName(employee.name)}, ${shiftType ?? "shift"}, ${shiftTimeLabel}${badge ? `, ${badge.label}` : ""}`;

  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.97 }}
      whileHover={{ y: -1, boxShadow: `0 4px 24px ${tint(shiftColor, 19)}` }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      aria-label={cardAriaLabel}
      data-scroll-anchor={`shift-${schedule.id}`}
      className="w-full text-left bg-card border border-line-subtle rounded-xl px-[14px] py-3 mb-2 flex items-center gap-3 cursor-pointer"
      style={{ borderLeft: `3px solid ${markColor(shiftColor)}`, boxShadow: glowShadow }}
    >
      {/* Avatar */}
      <div
        className="size-[38px] rounded-full flex items-center justify-center text-xs font-bold shrink-0"
        style={{
          background: tint(shiftColor, 13),
          border: `1.5px solid ${tint(shiftColor, 33)}`,
          color: shiftColor,
        }}
      >
        {getMonogram(employee.name)}
      </div>

      {/* Name + shift type */}
      <div className="flex-1 min-w-0">
        <div className={`font-semibold text-sm truncate ${isActive ? "text-fg" : "text-fg-muted"}`}>
          {formatDisplayName(employee.name)}
        </div>
        {(shiftType || isWalkIn) && (
          <div className="text-[11px] mt-0.5 capitalize flex items-center gap-1" style={{ color: shiftColor }}>
            {shiftType && <ShiftIcon shiftType={shiftType} size={12} color={shiftColor} />}
            {isWalkIn ? "Walk-in" : shiftType}
          </div>
        )}
      </div>

      {/* Right side */}
      <div className="text-right shrink-0">
        {!isWalkIn && (
          <div className="text-xs text-fg-muted whitespace-nowrap">
            {fromPrevDay && <span className="text-fg-subtle">Yesterday </span>}
            {fmtMinutes(schedule.startMinutes)} – {fmtMinutes(schedule.endMinutes)}
          </div>
        )}
        {/* The badge's row is always there, so a card is the same height
            before and after the punches load (SkeletonShiftCard matches). */}
        <div className="mt-[5px] min-h-6 flex justify-end items-center gap-1.5">
          {arrivalText && !badge && (
            <span className="text-xs text-fg-muted">{arrivalText}</span>
          )}
          {badge && (
            <span className={`text-[11px] leading-4 font-bold px-[9px] py-1 rounded-md flex items-center gap-1.5 select-none ${badge.className}`}>
              {(badge.label === "Clocked In" || badge.label === "Here") && (
                <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-ok opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-ok" />
                </span>
              )}
              {badge.label === "On Break" && (
                <motion.span
                  animate={{ opacity: [1, 0.4, 1] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                  className="relative flex h-2 w-2 shrink-0 rounded-full bg-warning-mark"
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
