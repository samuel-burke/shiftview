"use client";

import { Employee, Schedule, getMonogram } from "../data/types";
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
  );

  if (schedules) {
    const empMap = Object.fromEntries(employees.map((e) => [e.id, e]));
    const sorted = [...schedules].sort((a, b) =>
      a.startMinutes !== b.startMinutes
        ? a.startMinutes - b.startMinutes
        : a.endMinutes - b.endMinutes
    );

    return (
      <div style={{ marginBottom: 20 }}>
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

  // Off mode — employees without a schedule
  return (
    <div style={{ marginBottom: 20 }}>
      {sectionHeader}
      {employees.map((emp) => (
        <div
          key={emp.id}
          onClick={() => onSelectOff?.(emp)}
          style={{
            width: "100%",
            background: "#111827",
            border: "1px solid #1e293b",
            borderLeft: "3px solid #1e293b",
            borderRadius: 12,
            padding: "12px 14px",
            marginBottom: 8,
            display: "flex",
            alignItems: "center",
            gap: 12,
            cursor: onSelectOff ? "pointer" : "default",
          }}
        >
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: "50%",
              background: "#1e293b",
              border: "1.5px solid #334155",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 700,
              color: "#475569",
              flexShrink: 0,
            }}
          >
            {getMonogram(emp.name)}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontWeight: 600,
                fontSize: 14,
                color: "#64748b",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {emp.name}
            </div>
          </div>
          <div style={{ fontSize: 11, color: "#334155" }}>Off</div>
        </div>
      ))}
    </div>
  );
}
