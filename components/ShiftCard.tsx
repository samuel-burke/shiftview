"use client";

import {
  Employee,
  Schedule,
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
  nowMinutes: number;
  isToday: boolean;
  onClick: () => void;
};

export default function ShiftCard({
  employee,
  schedule,
  nowMinutes,
  isToday,
  onClick,
}: Props) {
  const shiftType = getShiftType(schedule.startMinutes, schedule.endMinutes);
  const here = isToday && isHere(schedule, nowMinutes);
  const shiftColor = shiftType ? SHIFT_COLORS[shiftType] : "#475569";

  let arrivalText: string | null = null;
  if (isToday && !here && schedule.startMinutes > nowMinutes) {
    const diff = schedule.startMinutes - nowMinutes;
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    arrivalText = h > 0 ? (m > 0 ? `In ${h}h ${m}m` : `In ${h}h`) : `In ${m}m`;
  }

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-gray-900 hover:bg-card border border-slate-800 rounded-xl px-[14px] py-3 mb-2 flex items-center gap-3 cursor-pointer transition-colors duration-150"
      style={{ borderLeft: `3px solid ${shiftColor}` }}
    >
      {/* Avatar */}
      <div
        className="size-[38px] rounded-full flex items-center justify-center text-xs font-bold shrink-0"
        style={{
          background: `${shiftColor}22`,
          border: `1.5px solid ${shiftColor}55`,
          color: shiftColor,
        }}
      >
        {getMonogram(employee.name)}
      </div>

      {/* Name + shift type */}
      <div className="flex-1 min-w-0">
        <div className={`font-semibold text-sm truncate ${here ? "text-slate-100" : "text-slate-500"}`}>
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
        <div className="text-[11px] text-slate-500 whitespace-nowrap">
          {fmtMinutes(schedule.startMinutes)} – {fmtMinutes(schedule.endMinutes)}
        </div>
        <div className="mt-[5px] flex justify-end items-center gap-1.5">
          {arrivalText && (
            <span className="text-[10px] text-slate-400">{arrivalText}</span>
          )}
          {here && (
            <span className="text-[11px] font-bold px-[9px] py-0.5 rounded-md bg-green-500/15 text-green-500">
              Here
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
