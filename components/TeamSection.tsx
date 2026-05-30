"use client";

import { Employee, Schedule, StoreHours, AttendanceStatus, getMonogram, formatDisplayName } from "../data/types";
import ShiftCard from "./ShiftCard";

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
        {sorted.map((sch) => {
          const emp = empMap[sch.employeeId];
          if (!emp) return null;
          return (
            <ShiftCard
              key={sch.id}
              employee={emp}
              schedule={sch}
              storeHours={storeHours ?? { open: 360, close: 1320 }}
              nowMinutes={nowMinutes}
              isToday={isToday}
              attendanceStatus={attendanceMap?.[emp.id]}
              onClick={() => onSelect?.(emp, sch)}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div className="mb-5">
      {sectionHeader}
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
        const baseClass = "flex items-center gap-3 w-full bg-gray-900 border border-slate-800 border-l-[3px] border-l-slate-800 rounded-xl px-[14px] py-3 mb-2";
        const selectable = onSelectOff && (!canSelectOff || canSelectOff(emp));
        return selectable ? (
          <button
            key={emp.id}
            onClick={() => onSelectOff(emp)}
            className={`${baseClass} cursor-pointer text-left`}
            aria-label={`View ${emp.name}`}
          >
            {inner}
          </button>
        ) : (
          <div key={emp.id} className={`${baseClass} cursor-default`}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}
