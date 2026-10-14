"use client";

import { motion } from "framer-motion";
import { Employee, Schedule, StoreHours, AttendanceStatus, getMonogram, formatDisplayName } from "../data/types";
import ShiftCard from "./ShiftCard";
import { shiftWindowOn } from "@/lib/shift-times";
import { tint } from "../lib/theme-colors";

const cardContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
};
const cardItem = {
  hidden: { opacity: 0, y: 8, scale: 0.98 },
  show: { opacity: 1, y: 0, scale: 1, transition: { type: "spring" as const, stiffness: 340, damping: 26 } },
};

type Props = {
  label: string;
  count: number;
  employees: Employee[];
  schedules?: Schedule[];
  storeHours?: StoreHours;
  nowMinutes: number;
  isToday: boolean;
  dayKey?: string;
  attendanceMap?: Record<number, AttendanceStatus>;
  onSelect?: (emp: Employee, sch: Schedule) => void;
  onSelectOff?: (emp: Employee) => void;
  canSelectOff?: (emp: Employee) => boolean;
  // Badge shown on the right of each row in the employee-list (no-schedule)
  // mode. Defaults to a neutral "Off". Used to render "Called Out" in red.
  statusLabel?: string;
  statusColor?: string;
};

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      data-testid="team-section-header"
      className="flex items-center gap-2 mb-[10px] text-xs font-bold text-fg-muted uppercase tracking-[0.08em] select-none"
    >
      {label}
      <span className="bg-fill border border-line-strong/80 rounded-full px-2 py-px text-[11px] text-fg-muted tabular-nums">
        {count}
      </span>
    </motion.div>
  );
}

export default function TeamSection({
  label,
  count,
  employees,
  schedules,
  storeHours,
  nowMinutes,
  isToday,
  dayKey,
  attendanceMap,
  onSelect,
  onSelectOff,
  canSelectOff,
  statusLabel = "Off",
  statusColor,
}: Props) {
  if (count === 0) return null;

  if (schedules) {
    const empMap = Object.fromEntries(employees.map((e) => [e.id, e]));
    const span = (s: Schedule) => (dayKey && s.date && s.startMinutes >= 0 ? shiftWindowOn(s, dayKey) : { start: s.startMinutes, end: s.endMinutes });
    const sorted = [...schedules].sort((a, b) => {
      const x = span(a), y = span(b);
      return x.start !== y.start ? x.start - y.start : x.end - y.end;
    });

    return (
      <div className="mb-5">
        <SectionHeader label={label} count={count} />
        <motion.div variants={cardContainer} initial="hidden" animate="show">
          {sorted.map((sch) => {
            const emp = empMap[sch.employeeId];
            if (!emp) return null;
            return (
              <motion.div key={sch.id} variants={cardItem}>
                <ShiftCard
                  employee={emp}
                  schedule={sch}
                  storeHours={storeHours ?? { open: 360, close: 1320 }}
                  nowMinutes={nowMinutes}
                  isToday={isToday}
                  dayKey={dayKey}
                  attendanceStatus={attendanceMap?.[emp.id]}
                  onClick={() => onSelect?.(emp, sch)}
                />
              </motion.div>
            );
          })}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="mb-5">
      <SectionHeader label={label} count={count} />
      <motion.div variants={cardContainer} initial="hidden" animate="show">
        {employees.map((emp) => {
          const inner = (
            <>
              <div className="size-[38px] rounded-full bg-fill/70 border-[1.5px] border-line-strong/60 flex items-center justify-center text-xs font-bold text-fg-subtle shrink-0">
                {getMonogram(emp.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-fg-subtle truncate">
                  {formatDisplayName(emp.name)}
                </div>
              </div>
              {statusColor ? (
                <div
                  className="text-[11px] font-bold px-2 py-0.5 rounded-md border"
                  style={{
                    color: statusColor,
                    background: tint(statusColor, 14),
                    borderColor: tint(statusColor, 35),
                  }}
                >
                  {statusLabel}
                </div>
              ) : (
                <div className="text-[11px] font-medium text-fg-subtle bg-fill/50 px-2 py-0.5 rounded-md border border-line-strong/40">
                  {statusLabel}
                </div>
              )}
            </>
          );
          const baseClass =
            "flex items-center gap-3 w-full bg-card/60 border border-line-subtle border-l-[3px] rounded-xl px-[14px] py-3 mb-2";
          const baseStyle = statusColor
            ? { borderLeftColor: tint(statusColor, 55) }
            : { borderLeftColor: "color-mix(in oklab, var(--color-line-strong) 50%, transparent)" };
          const selectable = onSelectOff && (!canSelectOff || canSelectOff(emp));
          return (
            <motion.div key={emp.id} variants={cardItem} data-scroll-anchor={`${label}-${emp.id}`}>
              {selectable ? (
                <motion.button
                  onClick={() => onSelectOff(emp)}
                  whileTap={{ scale: 0.97 }}
                  whileHover={{ y: -1, boxShadow: "var(--shadow-hover)" }}
                  transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  className={`${baseClass} cursor-pointer text-left`}
                  style={baseStyle}
                  aria-label={`View ${emp.name}`}
                >
                  {inner}
                </motion.button>
              ) : (
                <div className={`${baseClass} cursor-default`} style={baseStyle}>
                  {inner}
                </div>
              )}
            </motion.div>
          );
        })}
      </motion.div>
    </div>
  );
}
