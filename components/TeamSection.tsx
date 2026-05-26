"use client";

import { Employee, Schedule, getMonogram, formatDisplayName } from "../data/types";
import ShiftCard from "./ShiftCard";

type Props = {
  label: string;
  count: number;
  employees: Employee[];
  schedules?: Schedule[];
  nowMinutes: number;
  isToday: boolean;
  onSelect?: (emp: Employee, sch: Schedule) => void;
  onSelectOff?: (emp: Employee) => void;
};

export default function TeamSection({
  label,
  count,
  employees,
  schedules,
  nowMinutes,
  isToday,
  onSelect,
  onSelectOff,
}: Props) {
  if (count === 0) return null;

  const sectionHeader = (
    <div className="flex items-center gap-2 mb-[10px] text-xs font-bold text-slate-500 uppercase tracking-[0.08em]">
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
              nowMinutes={nowMinutes}
              isToday={isToday}
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
      {employees.map((emp) => (
        <div
          key={emp.id}
          onClick={() => onSelectOff?.(emp)}
          className={`flex items-center gap-3 w-full bg-gray-900 border border-slate-800 border-l-[3px] border-l-slate-800 rounded-xl px-[14px] py-3 mb-2 ${onSelectOff ? "cursor-pointer" : "cursor-default"}`}
        >
          <div className="size-[38px] rounded-full bg-slate-800 border-[1.5px] border-slate-700 flex items-center justify-center text-xs font-bold text-slate-600 shrink-0">
            {getMonogram(emp.name)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-slate-500 truncate">
              {formatDisplayName(emp.name)}
            </div>
          </div>
          <div className="text-[11px] text-slate-700">Off</div>
        </div>
      ))}
    </div>
  );
}
