"use client";

import { motion } from "framer-motion";
import { Employee, Schedule, StoreHours, AttendanceStatus, getMonogram, formatDisplayName } from "../data/types";
import ShiftCard from "./ShiftCard";

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
  attendanceMap?: Record<number, AttendanceStatus>;
  onSelect?: (emp: Employee, sch: Schedule) => void;
  onSelectOff?: (emp: Employee) => void;
  canSelectOff?: (emp: Employee) => boolean;
};

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="flex items-center gap-2 mb-[10px] text-xs font-bold text-slate-400 uppercase tracking-[0.08em]"
    >
      {label}
      <span className="bg-slate-800 border border-slate-700/80 rounded-full px-2 py-px text-[11px] text-slate-400 tabular-nums">
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
  attendanceMap,
  onSelect,
  onSelectOff,
  canSelectOff,
}: Props) {
  if (count === 0) return null;

  if (schedules) {
    const empMap = Object.fromEntries(employees.map((e) => [e.id, e]));
    const sorted = [...schedules].sort((a, b) =>
      a.startMinutes !== b.startMinutes
        ? a.startMinutes - b.startMinutes
        : a.endMinutes - b.endMinutes
    );

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
              <div className="size-[38px] rounded-full bg-slate-800/70 border-[1.5px] border-slate-700/60 flex items-center justify-center text-xs font-bold text-slate-500 shrink-0">
                {getMonogram(emp.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-slate-500 truncate">
                  {formatDisplayName(emp.name)}
                </div>
              </div>
              <div className="text-[11px] font-medium text-slate-600 bg-slate-800/50 px-2 py-0.5 rounded-md border border-slate-700/40">
                Off
              </div>
            </>
          );
          const baseClass =
            "flex items-center gap-3 w-full bg-card/60 border border-white/[0.05] border-l-[3px] border-l-slate-700/50 rounded-xl px-[14px] py-3 mb-2";
          const selectable = onSelectOff && (!canSelectOff || canSelectOff(emp));
          return (
            <motion.div key={emp.id} variants={cardItem}>
              {selectable ? (
                <motion.button
                  onClick={() => onSelectOff(emp)}
                  whileTap={{ scale: 0.97 }}
                  whileHover={{ y: -1, boxShadow: "0 4px 12px rgba(0,0,0,0.25)" }}
                  transition={{ type: "spring", stiffness: 400, damping: 25 }}
                  className={`${baseClass} cursor-pointer text-left`}
                  aria-label={`View ${emp.name}`}
                >
                  {inner}
                </motion.button>
              ) : (
                <div className={`${baseClass} cursor-default`}>
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
