"use client";

import { useState, useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useIsDesktop } from "../hooks/useIsDesktop";

type Props = {
  open: boolean;
  selected: Date;
  today: Date;
  firstDayOfWeek?: number;
  onSelect: (date: Date) => void;
  onClose: () => void;
};

const ALL_WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function getCalendarDays(year: number, month: number, firstDayOfWeek: number): (Date | null)[] {
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const offset = (firstDow - firstDayOfWeek + 7) % 7;
  const days: (Date | null)[] = Array(offset).fill(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(new Date(year, month, d));
  return days;
}

export default function DatePickerSheet({ open, selected, today, firstDayOfWeek = 6, onSelect, onClose }: Props) {
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

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && open) onClose();
  }, [open, onClose]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }

  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const WEEKDAYS = Array.from({ length: 7 }, (_, i) => ALL_WEEKDAYS[(firstDayOfWeek + i) % 7]);
  const days = getCalendarDays(viewYear, viewMonth, firstDayOfWeek);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            className="fixed inset-0 bg-black/60 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          {isDesktop ? (
            <motion.div
              key="panel"
              role="dialog"
              aria-modal="true"
              aria-label={`Date picker — ${MONTHS[viewMonth]} ${viewYear}`}
              className="fixed top-1/2 left-1/2 z-50 bg-bg border border-slate-800 rounded-[20px] w-[360px] p-6 pb-7"
              initial={{ opacity: 0, scale: 0.96, x: "-50%", y: "-48%" }}
              animate={{ opacity: 1, scale: 1, x: "-50%", y: "-50%" }}
              exit={{ opacity: 0, scale: 0.96, x: "-50%", y: "-48%" }}
              transition={{ type: "spring", damping: 28, stiffness: 320 }}
            >
              {sheetContent()}
            </motion.div>
          ) : (
            <motion.div
              key="panel"
              role="dialog"
              aria-modal="true"
              aria-label={`Date picker — ${MONTHS[viewMonth]} ${viewYear}`}
              className="fixed bottom-0 left-0 right-0 z-50 bg-bg border-t border-slate-800 rounded-t-3xl max-w-[480px] mx-auto px-6 pb-11 pt-3"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 32, stiffness: 300 }}
            >
              <div className="flex justify-center mb-5">
                <div className="w-10 h-1 rounded-full bg-slate-700" />
              </div>
              {sheetContent()}
            </motion.div>
          )}
        </>
      )}
    </AnimatePresence>
  );

  function sheetContent() {
    return (
      <>
        {/* Month nav */}
        <div className="flex items-center justify-between mb-5">
          <button
            onClick={prevMonth}
            aria-label={`Previous month, ${viewMonth === 0 ? MONTHS[11] : MONTHS[viewMonth - 1]} ${viewMonth === 0 ? viewYear - 1 : viewYear}`}
            className={navBtn}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <span className="text-base font-bold text-slate-100" aria-live="polite">
            {MONTHS[viewMonth]} {viewYear}
          </span>
          <button
            onClick={nextMonth}
            aria-label={`Next month, ${viewMonth === 11 ? MONTHS[0] : MONTHS[viewMonth + 1]} ${viewMonth === 11 ? viewYear + 1 : viewYear}`}
            className={navBtn}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
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

            const fullLabel = day.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

            return (
              <div key={i} className="flex flex-col items-center gap-[3px]">
                <button
                  onClick={() => { onSelect(day); onClose(); }}
                  aria-label={fullLabel}
                  aria-pressed={isSelected}
                  className={`size-[44px] rounded-full border-none cursor-pointer text-sm flex items-center justify-center ${
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

const navBtn = "size-11 rounded-full bg-slate-800 border border-slate-700 text-slate-400 text-base cursor-pointer flex items-center justify-center shrink-0 hover:bg-slate-700 hover:text-slate-200 transition-colors";
