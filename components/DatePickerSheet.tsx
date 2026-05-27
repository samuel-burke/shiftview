"use client";

import { useState, useEffect } from "react";
import { useIsDesktop } from "../hooks/useIsDesktop";

type Props = {
  open: boolean;
  selected: Date;
  today: Date;
  onSelect: (date: Date) => void;
  onClose: () => void;
};

const WEEKDAYS = ["Sa", "Su", "Mo", "Tu", "We", "Th", "Fr"];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function getCalendarDays(year: number, month: number): (Date | null)[] {
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days: (Date | null)[] = Array((firstDow + 1) % 7).fill(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(new Date(year, month, d));
  return days;
}

export default function DatePickerSheet({ open, selected, today, onSelect, onClose }: Props) {
  const isDesktop = useIsDesktop();
  const [viewYear, setViewYear] = useState(selected.getFullYear());
  const [viewMonth, setViewMonth] = useState(selected.getMonth());

  useEffect(() => {
    if (open) {
      setViewYear(selected.getFullYear());
      setViewMonth(selected.getMonth());
    }
  }, [open, selected]);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const days = getCalendarDays(viewYear, viewMonth);

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 bg-black/60 z-40 transition-opacity duration-[250ms] ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
      />

      {/* Sheet */}
      {isDesktop ? (
        <div
          className={`fixed top-1/2 left-1/2 z-50 bg-slate-900 border border-slate-800 rounded-[20px] w-[360px] p-6 pb-7 transition-[opacity,transform] duration-200 ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
          style={{ transform: open ? "translate(-50%, -50%)" : "translate(-50%, -48%)" }}
        >
          {sheetContent()}
        </div>
      ) : (
        <div
          className={`fixed bottom-0 left-0 right-0 z-50 bg-slate-900 border-t border-slate-800 rounded-t-3xl max-w-[480px] mx-auto px-6 pb-11 pt-3 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${open ? "translate-y-0" : "translate-y-full"}`}
        >
          <div className="flex justify-center mb-5">
            <div className="w-10 h-1 rounded-full bg-slate-700" />
          </div>
          {sheetContent()}
        </div>
      )}
    </>
  );

  function sheetContent() {
    return (
      <>
        {/* Month nav */}
        <div className="flex items-center justify-between mb-5">
          <button onClick={prevMonth} className={navBtn}>←</button>
          <span className="text-base font-bold text-slate-100">
            {MONTHS[viewMonth]} {viewYear}
          </span>
          <button onClick={nextMonth} className={navBtn}>→</button>
        </div>

        {/* Weekday headers */}
        <div className="grid grid-cols-7 mb-2">
          {WEEKDAYS.map(d => (
            <div key={d} className="text-center text-[11px] font-semibold text-slate-400 pb-1.5">
              {d}
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div className="grid grid-cols-7 gap-y-1">
          {days.map((day, i) => {
            if (!day) return <div key={i} />;

            const isSelected = sameDay(day, selected);
            const isToday_ = sameDay(day, today);

            return (
              <div key={i} className="flex flex-col items-center gap-[3px]">
                <button
                  onClick={() => { onSelect(day); onClose(); }}
                  className={`size-[38px] rounded-full border-none cursor-pointer text-sm flex items-center justify-center ${
                    isSelected
                      ? "bg-gradient-to-br from-blue-500 to-violet-500 text-white font-bold"
                      : isToday_
                      ? "bg-transparent text-blue-500 font-bold"
                      : "bg-transparent text-slate-400 font-normal"
                  }`}
                >
                  {day.getDate()}
                </button>
                {isToday_ && !isSelected && (
                  <div className="size-1 rounded-full bg-blue-500" />
                )}
              </div>
            );
          })}
        </div>
      </>
    );
  }
}

const navBtn = "size-9 rounded-full bg-slate-800 border border-slate-700 text-slate-400 text-base cursor-pointer flex items-center justify-center shrink-0";
