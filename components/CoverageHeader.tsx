"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CoverageStatus } from "../data/types";
import DatePickerSheet from "./DatePickerSheet";
import UserMenu from "./UserMenu";
import NotificationBell from "./NotificationBell";
import { WarningIcon, CalendarIcon, LockIcon } from "./ShiftIcons";

type Props = {
  date: Date;
  today: Date;
  onPrev: () => void;
  onNext: () => void;
  onNow: () => void;
  onSignOut?: () => void;
  onSignIn?: () => void;
  onDateSelect: (date: Date) => void;
  isToday: boolean;
  hereCount: number;
  nowMinutes: number;
  coverageStatus: CoverageStatus;
  isDemo: boolean;
  loading?: boolean;
  userName?: string | null;
  isManager?: boolean;
  coverageAlertsEnabled?: boolean;
  hideMobileBrand?: boolean;
};

function fmtTime(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return min === 0
    ? `${h12}:00 ${ampm}`
    : `${h12}:${String(min).padStart(2, "0")} ${ampm}`;
}

function NavButton({ onClick, label, children }: { onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <motion.button
      onClick={onClick}
      aria-label={label}
      whileTap={{ scale: 0.88 }}
      whileHover={{ scale: 1.08, boxShadow: "0 0 12px rgba(99,102,241,0.25)" }}
      transition={{ type: "spring", stiffness: 450, damping: 25 }}
      className="size-11 rounded-full bg-slate-800 border border-slate-700 text-slate-400 text-base cursor-pointer flex items-center justify-center shrink-0"
    >
      {children}
    </motion.button>
  );
}

const prevArrow = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
const nextArrow = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;

export default function CoverageHeader({
  date,
  today,
  onPrev,
  onNext,
  onNow,
  onSignOut,
  onSignIn,
  onDateSelect,
  isToday,
  hereCount,
  nowMinutes,
  coverageStatus,
  isDemo,
  loading = false,
  userName = null,
  isManager = false,
  coverageAlertsEnabled = true,
  hideMobileBrand = false,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const dateLabel = date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const dayName = date.toLocaleDateString("en-US", { weekday: "long" });
  const timeStr = fmtTime(nowMinutes);
  const isPast = date < today && !isToday;
  const isFuture = date > today && !isToday;

  const alertConfig = (() => {
    if (isPast || isFuture)
      return { icon: <CalendarIcon size={13} color="#94a3b8" />, message: isPast ? "Viewing past schedule" : "Viewing future schedule", bg: "rgba(71,85,105,0.12)", border: "rgba(71,85,105,0.3)", text: "#94a3b8" };
    if (coverageStatus === "closed")
      return { icon: <LockIcon size={13} color="#94a3b8" />, message: "Store closed", bg: "rgba(71,85,105,0.12)", border: "rgba(71,85,105,0.3)", text: "#94a3b8" };
    if (coverageStatus === "critical")
      return { icon: <WarningIcon size={13} color="#f87171" />, message: `Coverage below minimum — ${hereCount} here now`, bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.3)", text: "#f87171" };
    if (coverageStatus === "low")
      return { icon: <WarningIcon size={13} color="#fbbf24" />, message: `Coverage below optimal — ${hereCount} here now`, bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.3)", text: "#fbbf24" };
    return null;
  })();

  const alertKey = alertConfig?.message ?? "none";
  // Past/future alerts are deterministic (date prop always known), show immediately.
  // Coverage status alerts depend on loaded data, gate on !loading.
  const showAlert = coverageAlertsEnabled && alertConfig && (!loading || isPast || isFuture);

  // Mobile nav: full-width justify-between, large date text, live time below
  const mobileNav = (
    <div className="flex items-center justify-between">
      <NavButton onClick={onPrev} label="Previous day">{prevArrow}</NavButton>
      <motion.button
        onClick={() => setPickerOpen(true)}
        aria-label={`${dateLabel}, ${dayName}. Open date picker`}
        aria-expanded={pickerOpen}
        aria-haspopup="dialog"
        whileTap={{ scale: 0.97 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        className="text-center bg-transparent border-none cursor-pointer p-0"
      >
        <div className="text-2xl font-extrabold text-slate-100 tracking-tight flex items-center gap-1.5">
          {dateLabel}
          <motion.span
            animate={{ rotate: pickerOpen ? 180 : 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 22 }}
            className="inline-block"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-blue-500"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </motion.span>
        </div>
      </motion.button>
      <NavButton onClick={onNext} label="Next day">{nextArrow}</NavButton>
    </div>
  );

  // Desktop nav: compact gap-based, inline time beside day name
  const desktopNav = (
    <div className="flex items-center gap-4">
      <NavButton onClick={onPrev} label="Previous day">{prevArrow}</NavButton>
      <motion.button
        onClick={() => setPickerOpen(true)}
        aria-label={`${dateLabel}, ${dayName}. Open date picker`}
        aria-expanded={pickerOpen}
        aria-haspopup="dialog"
        whileTap={{ scale: 0.97 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        className="text-center bg-transparent border-none cursor-pointer px-2"
      >
        <div className="text-lg font-extrabold text-slate-100 tracking-tight flex items-center gap-1.5">
          {dateLabel}
          <span className="text-[13px] text-blue-500 font-normal">▾</span>
        </div>
      </motion.button>
      <NavButton onClick={onNext} label="Next day">{nextArrow}</NavButton>
    </div>
  );

  return (
    <div className="mb-4 [@media(min-width:900px)]:mb-6">
      {/* Desktop-only demo banner (above the bar) */}
      {isDemo && (
        <div className="hidden [@media(min-width:900px)]:flex bg-blue-500/8 border-b border-blue-500/15 px-4 py-1.5 items-center justify-between">
          <span className="text-[11px] text-blue-400/80 font-medium">Demo Mode · Changes are not saved</span>
          <a href="/login" className="text-[11px] font-bold text-blue-400 hover:text-blue-300 transition-colors">Sign In →</a>
        </div>
      )}

      {/*
       * Sticky on mobile (eliminates the JS-measured spacer div that was the main CLS source).
       * Static on desktop (content scrolls with the page in the desktop layout).
       * The `[@media(min-width:900px)]:contents` on the inner row makes brand + actions
       * become direct flex children of this bar on desktop, putting the date nav in the
       * centre between them.
       */}
      <div
        className="sticky top-0 z-30 bg-bg border-b border-slate-800 px-4 pb-3 header-safe-top
                   [@media(min-width:900px)]:static [@media(min-width:900px)]:flex
                   [@media(min-width:900px)]:items-center [@media(min-width:900px)]:gap-6
                   [@media(min-width:900px)]:px-6 [@media(min-width:900px)]:py-[14px]"
      >
        {/* Mobile-only demo banner (inside bar) */}
        {isDemo && (
          <div className="-mx-4 mb-2 px-4 py-1.5 bg-blue-500/8 border-b border-blue-500/15 flex items-center justify-between [@media(min-width:900px)]:hidden">
            <span className="text-[11px] text-blue-400/80 font-medium">Demo Mode · Changes are not saved</span>
            <a href="/login" className="text-[11px] font-bold text-blue-400">Sign In →</a>
          </div>
        )}

        {/* Brand + actions row (mobile row-1; on desktop: contents trick merges into parent flex) */}
        <div className={`flex items-center justify-between mb-3 [@media(min-width:900px)]:contents${hideMobileBrand ? " [@media(max-width:899px)]:hidden" : ""}`}>
          <div className="[@media(min-width:900px)]:shrink-0">
            <span className="text-2xl font-extrabold text-slate-100 tracking-tight [@media(min-width:900px)]:text-[22px]">
              Shift
              <span className="bg-gradient-to-r from-blue-500 to-violet-500 bg-clip-text text-transparent">
                View
              </span>
            </span>
            <div className="[@media(min-width:900px)]:hidden text-[11px] text-slate-400 mt-0.5">
              {dayName} · {dateLabel}
            </div>
          </div>

          {/* Desktop centred date nav — sits between brand and actions in the flex row */}
          <div className="hidden [@media(min-width:900px)]:flex flex-1 justify-center">
            {desktopNav}
          </div>

          <div className="flex items-center gap-2 [@media(min-width:900px)]:shrink-0">
            {!isToday && (
              <motion.button
                onClick={onNow}
                whileTap={{ scale: 0.93 }}
                whileHover={{ scale: 1.04 }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
                className="text-[13px] font-bold text-slate-100 bg-slate-800 border border-slate-700 rounded-[10px] px-4 py-2.5 cursor-pointer"
              >
                TODAY
              </motion.button>
            )}
            {!isDemo && <NotificationBell />}
            <UserMenu name={userName} isManager={isManager} onSignOut={onSignOut} onSignIn={onSignIn} />
          </div>
        </div>

        {/* Mobile-only date nav row */}
        <div data-testid="mobile-date-nav" className="mb-1 [@media(min-width:900px)]:hidden">
          {mobileNav}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {showAlert && (
          <motion.div
            key={alertKey}
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="px-[14px] py-[10px] rounded-[10px] text-xs flex items-center gap-2 mt-3 [@media(min-width:900px)]:mx-6"
            style={{ background: alertConfig!.bg, border: `1px solid ${alertConfig!.border}`, color: alertConfig!.text }}
          >
            {alertConfig!.icon}
            <span>{alertConfig!.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <DatePickerSheet open={pickerOpen} selected={date} today={today} onSelect={onDateSelect} onClose={() => setPickerOpen(false)} />
    </div>
  );
}
