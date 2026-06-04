"use client";

import { motion } from "framer-motion";
import { Employee, Schedule, StoreHours, AttendanceStatus, getMonogram, formatDisplayName } from "../data/types";
import ShiftCard from "./ShiftCard";

const cardContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.045 } },
};
const cardItem = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 320, damping: 26 } },
};

type Props = {
  label: string;
  count: number;
  employees: Employee[];
  schedules?: Schedule[];
  storeHours?: StoreHours;
  nowMinutes: number;
  isToday: boolean;
  attendanceMap?: Record<number, AttendanceStatus>; // keyed by employeeId
  onSelect?: (emp: Employee, sch: Schedule) => void;
  onSelectOff?: (emp: Employee) => void;
  canSelectOff?: (emp: Employee) => boolean;
};

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

  const sectionHeader = (
    <div className="flex items-center gap-2 mb-[10px] text-xs font-bold text-slate-400 uppercase tracking-[0.08em]">
      {label}
      <span className="bg-slate-800 border border-slate-700 rounded-full px-2 py-px text-[11px] text-slate-400">
        {count}
      </span>
    </div>
  );

  if (schedules) {
    const empMap = Object.fromEntries(employees.map((e) => [e.id, e]));
    const sorted = [...schedules].sort((a, b) =>
      a.startMinutes !== b.startMinutes
        ? a.startMinutes - b.startMinutes
        : a.endMinutes - b.endMinutes
    );

    return (
      <div className="mb-5">
        {sectionHeader}
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
      {sectionHeader}
      <motion.div variants={cardContainer} initial="hidden" animate="show">
        {employees.map((emp) => {
          const inner = (
            <>
              <div className="size-[38px] rounded-full bg-slate-800 border-[1.5px] border-slate-700 flex items-center justify-center text-xs font-bold text-slate-400 shrink-0">
                {getMonogram(emp.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm text-slate-400 truncate">
                  {formatDisplayName(emp.name)}
                </div>
              </div>
              <div className="text-[11px] text-slate-400">Off</div>
            </>
          );
          const baseClass = "flex items-center gap-3 w-full bg-card border border-white/[0.08] border-l-[3px] border-l-slate-700 rounded-xl px-[14px] py-3 mb-2 transition-transform duration-200 hover:-translate-y-0.5";
          const selectable = onSelectOff && (!canSelectOff || canSelectOff(emp));
          return (
            <motion.div key={emp.id} variants={cardItem}>
              {selectable ? (
                <motion.button
                  onClick={() => onSelectOff(emp)}
                  whileTap={{ scale: 0.97 }}
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
