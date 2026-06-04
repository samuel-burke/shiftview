"use client";

import { Schedule, StoreHours, TimeOffRequest, getShiftType, SHIFT_COLORS, TIME_OFF_COLORS } from "../data/types";
import { SunriseIcon, SunIcon, MoonIcon, ShiftIcon, TimeOffPendingIcon, TimeOffApprovedIcon, TimeOffDeniedIcon } from "./ShiftIcons";

const TIME_OFF_STATUS_LABELS: Record<TimeOffRequest["status"], string> = {
  pending: "Time off pending",
  approved: "Time off approved",
  denied: "Time off denied",
};

type Props = {
  schedules: Schedule[];
  weeklyHours: Record<number, StoreHours>;
  firstDayOfWeek?: number;
  selectedDate: Date;
  navDate: Date;
  onSelectDate: (d: Date) => void;
  today: Date;
  timeOffRequests?: TimeOffRequest[];
};

const ALL_DAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function toDateKey(d: Date) {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

export default function MonthView({ schedules, weeklyHours, firstDayOfWeek = 6, selectedDate, navDate, onSelectDate, today, timeOffRequests = [] }: Props) {
  const todayKey = toDateKey(today);
  const selectedKey = toDateKey(selectedDate);
  const DAY_LABELS = Array.from({ length: 7 }, (_, i) => ALL_DAYS[(firstDayOfWeek + i) % 7]);

  const year = navDate.getFullYear();
  const month = navDate.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = (firstDow - firstDayOfWeek + 7) % 7;

  const cells: (Date | null)[] = [
    ...Array.from({ length: startOffset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <div className="mb-3">
      {/* Legend */}
      <div className="flex flex-col gap-2 mb-3 px-3 py-2 bg-card rounded-xl border border-slate-800/60">
        <div className="flex gap-3 flex-wrap">
          <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider w-full">Shifts</span>
          {([
            { label: "Opening", color: SHIFT_COLORS.opener, Icon: SunriseIcon },
            { label: "Mid",     color: SHIFT_COLORS.mid,    Icon: SunIcon },
            { label: "Closing", color: SHIFT_COLORS.closer,  Icon: MoonIcon },
          ] as const).map(({ label, color, Icon }) => (
            <div key={label} className="flex items-center gap-1">
              <Icon size={12} color={color} />
              <span className="text-[11px] font-medium" style={{ color }}>{label}</span>
            </div>
          ))}
        </div>
        <div className="h-px bg-slate-800/60" />
        <div className="flex gap-3 flex-wrap">
          <span className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider w-full">Time Off</span>
          {([
            { label: "Pending",  color: TIME_OFF_COLORS.pending,  Icon: TimeOffPendingIcon },
            { label: "Approved", color: TIME_OFF_COLORS.approved, Icon: TimeOffApprovedIcon },
            { label: "Denied",   color: TIME_OFF_COLORS.denied,   Icon: TimeOffDeniedIcon },
          ] as const).map(({ label, color, Icon }) => (
            <div key={label} className="flex items-center gap-1">
              <Icon size={12} color={color} />
              <span className="text-[11px] font-medium" style={{ color }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 mb-1.5">
        {DAY_LABELS.map((d) => (
          <div key={d} className="text-center text-[10px] text-slate-400 font-semibold tracking-wider py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="flex flex-col gap-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1">
            {week.map((d, di) => {
              if (!d) return <div key={di} />;

              const dateKey = toDateKey(d);
              const isToday = dateKey === todayKey;
              const isSelected = dateKey === selectedKey;
              const schedule = schedules.find((s) => s.date.slice(0, 10) === dateKey) ?? null;
              const dayHours = weeklyHours[d.getDay()] ?? { open: 360, close: 1320 };
              const shiftType = schedule ? getShiftType(schedule.startMinutes, schedule.endMinutes, dayHours.open, dayHours.close) : null;
              const shiftColor = shiftType ? SHIFT_COLORS[shiftType] : null;
              const timeOff = !schedule ? (timeOffRequests.find((r) => r.date === dateKey) ?? null) : null;
              const fullDate = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
              const statusText = shiftType
                ? `${shiftType} shift`
                : timeOff
                ? TIME_OFF_STATUS_LABELS[timeOff.status]
                : "Off";
              const dayAriaLabel = `${fullDate}. ${statusText}${isToday ? ". Today" : ""}`;

              return (
                <button
                  key={di}
                  onClick={() => onSelectDate(d)}
                  aria-label={dayAriaLabel}
                  aria-pressed={isSelected}
                  className={`h-[52px] flex flex-col items-center justify-center rounded-xl transition-colors cursor-pointer ${
                    isSelected
                      ? "border border-indigo-500 bg-indigo-500/10"
                      : "border border-slate-800/50 bg-card"
                  }`}
                >
                  <div
                    className={`size-6 flex items-center justify-center rounded-full text-xs font-semibold ${
                      isToday ? "bg-indigo-500 text-white" : "text-slate-300"
                    }`}
                  >
                    {d.getDate()}
                  </div>
                  <div className="h-[14px] mt-0.5 flex items-center justify-center">
                    {shiftType && shiftColor && <ShiftIcon shiftType={shiftType} size={12} color={shiftColor} />}
                    {timeOff?.status === "pending"  && <TimeOffPendingIcon  size={12} color={TIME_OFF_COLORS.pending}  />}
                    {timeOff?.status === "approved" && <TimeOffApprovedIcon size={12} color={TIME_OFF_COLORS.approved} />}
                    {timeOff?.status === "denied"   && <TimeOffDeniedIcon   size={12} color={TIME_OFF_COLORS.denied}   />}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
