"use client";

import { Employee, Schedule } from "../data/types";
import ShiftCard from "./ShiftCard";

type Props = {
  label: string;
  count: number;
  schedules: Schedule[];
  employees: Employee[];
  nowMinutes: number;
  isToday: boolean;
  onSelect: (emp: Employee, sch: Schedule) => void;
};

export default function TeamSection({
  label,
  count,
  schedules,
  employees,
  nowMinutes,
  isToday,
  onSelect,
}: Props) {
  if (schedules.length === 0) return null;
  const empMap = Object.fromEntries(employees.map((e) => [e.id, e]));

  // Sort by startMinutes ascending (off/unscheduled go last)
  const sorted = [...schedules].sort((a, b) => {
    if (a.startMinutes < 0 && b.startMinutes < 0) return 0;
    if (a.startMinutes < 0) return 1;
    if (b.startMinutes < 0) return -1;
    return a.startMinutes - b.startMinutes;
  });

  return (
    <div style={{ marginBottom: 20 }}>
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: "#64748b",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          marginBottom: 10,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        {label}
        <span
          style={{
            background: "#1e293b",
            border: "1px solid #334155",
            borderRadius: 20,
            padding: "1px 8px",
            fontSize: 11,
            color: "#94a3b8",
          }}
        >
          {count}
        </span>
      </div>
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
            onClick={() => onSelect(emp, sch)}
          />
        );
      })}
    </div>
  );
}
