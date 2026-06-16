"use client";

import { Schedule, StoreHours, TimeOffRequest, getShiftType, SHIFT_COLORS, TIME_OFF_COLORS, CALLOUT_COLOR } from "../data/types";
import { ShiftIcon, TimeOffPendingIcon, TimeOffApprovedIcon, TimeOffDeniedIcon, MegaphoneIcon } from "./ShiftIcons";

const TIME_OFF_LABELS: Record<TimeOffRequest["status"], string> = {
  pending: "REQ",
  approved: "APR",
  denied: "DEN",
};


type Props = {
  schedules: Schedule[];
  weeklyHours: Record<number, StoreHours>;
  firstDayOfWeek?: number;
  selectedDate: Date;
  weekStart: Date;
  onSelectDate: (d: Date) => void;
  today: Date;
  timeOffRequests?: TimeOffRequest[];
  calloutDates?: string[];
};

const ALL_DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

const SHIFT_LABELS: Record<string, string> = {
  opener: "EARLY",
  mid: "MID",
  closer: "LATE",
};


function toDateKey(d: Date) {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function shortTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const suffix = h < 12 ? "a" : "p";
  return m === 0 ? `${h12}${suffix}` : `${h12}:${String(m).padStart(2, "0")}${suffix}`;
}

export default function WeekView({ schedules, weeklyHours, firstDayOfWeek = 6, selectedDate, weekStart, onSelectDate, today, timeOffRequests = [], calloutDates = [] }: Props) {
  const todayKey = toDateKey(today);
  const selectedKey = toDateKey(selectedDate);
  const DAY_LABELS = Array.from({ length: 7 }, (_, i) => ALL_DAYS[(firstDayOfWeek + i) % 7]);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });

  return (
    <div className="flex gap-1.5 mb-3">
      {days.map((d, i) => {
        const dateKey = toDateKey(d);
        const isToday = dateKey === todayKey;
        const isSelected = dateKey === selectedKey;
        const schedule = schedules.find((s) => s.date.slice(0, 10) === dateKey) ?? null;
        const dayHours = weeklyHours[d.getDay()] ?? { open: 360, close: 1320 };
        const shiftType = schedule ? getShiftType(schedule.startMinutes, schedule.endMinutes, dayHours.open, dayHours.close) : null;
        const shiftColor = shiftType ? SHIFT_COLORS[shiftType] : null;
        const calledOut = calloutDates.includes(dateKey);
        const timeOff = !schedule ? (timeOffRequests.find((r) => r.date === dateKey) ?? null) : null;
        const shiftLabel = calledOut ? "OUT" : shiftType ? SHIFT_LABELS[shiftType] : timeOff ? TIME_OFF_LABELS[timeOff.status] : "Off";
        const labelColor = calledOut ? CALLOUT_COLOR : (shiftColor ?? (timeOff ? TIME_OFF_COLORS[timeOff.status] : "#94a3b8"));

        const fullDayLabel = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
        const statusText = calledOut
          ? "Called out"
          : shiftType
          ? `${shiftType} shift, ${shortTime(schedule!.startMinutes)} to ${shortTime(schedule!.endMinutes)}`
          : timeOff
          ? `Time off request, ${timeOff.status}`
          : "Off";
        const dayAriaLabel = `${fullDayLabel}. ${statusText}${isToday ? ". Today" : ""}`;

        return (
          <button
            key={i}
            onClick={() => onSelectDate(d)}
            aria-label={dayAriaLabel}
            aria-pressed={isSelected}
            className={`flex-1 flex flex-col items-center rounded-xl py-2 px-0.5 transition-colors cursor-pointer ${
              isSelected
                ? "border border-indigo-500 bg-indigo-500/10 hover:bg-indigo-500/20"
                : "border border-slate-800 bg-card hover:bg-slate-800/60"
            }`}
          >
            <div className="text-[9px] text-slate-400 font-semibold tracking-wider mb-1.5 select-none">
              {DAY_LABELS[i]}
            </div>
            <div
              className={`size-7 flex items-center justify-center rounded-full text-sm font-bold mb-1.5 ${
                isToday ? "bg-indigo-500 text-white" : "text-slate-100"
              }`}
            >
              {d.getDate()}
            </div>
            <div
              className="w-6 h-[3px] rounded-full mb-1"
              style={{ background: labelColor ?? "transparent", visibility: (calledOut || shiftColor || timeOff) ? "visible" : "hidden" }}
            />
            <div className="mb-0.5 h-[14px] flex items-center justify-center">
              {calledOut ? (
                <MegaphoneIcon size={13} color={CALLOUT_COLOR} />
              ) : shiftType ? (
                <ShiftIcon shiftType={shiftType} size={13} color={shiftColor ?? "#94a3b8"} />
              ) : timeOff?.status === "pending" ? (
                <TimeOffPendingIcon size={13} color={TIME_OFF_COLORS.pending} />
              ) : timeOff?.status === "approved" ? (
                <TimeOffApprovedIcon size={13} color={TIME_OFF_COLORS.approved} />
              ) : timeOff?.status === "denied" ? (
                <TimeOffDeniedIcon size={13} color={TIME_OFF_COLORS.denied} />
              ) : (
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M14 8.5A6 6 0 1 1 7.5 2a4.5 4.5 0 0 0 6.5 6.5Z" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
            <div
              className="text-[9px] font-semibold tracking-wider leading-tight"
              style={{ color: labelColor }}
            >
              {shiftLabel}
            </div>
            {!calledOut && schedule && shiftType && (
              <div className="text-[8px] text-slate-400 mt-0.5 leading-tight">
                {shortTime(schedule.startMinutes)}–{shortTime(schedule.endMinutes)}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
