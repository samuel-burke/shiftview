"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CoverageStatus } from "../data/types";
import DatePickerSheet from "./DatePickerSheet";
import UserMenu from "./UserMenu";
import NotificationBell from "./NotificationBell";
import { WarningIcon, CalendarIcon, LockIcon, TimeOffApprovedIcon } from "./ShiftIcons";
import Logo from "@/components/Logo";
import DemoBanner from "./DemoBanner";

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
  loading?: boolean;
  userName?: string | null;
  isManager?: boolean;
  coverageAlertsEnabled?: boolean;
  hideMobileBrand?: boolean;
};

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
  coverageStatus,
  loading = false,
  userName = null,
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
  const isPast = date < today && !isToday;
  const isFuture = date > today && !isToday;

  const alertConfig = (() => {
    if (isPast || isFuture)
      return { icon: <CalendarIcon size={13} color="#94a3b8" />, message: isPast ? "Viewing past schedule" : "Viewing future schedule", bg: "rgba(71,85,105,0.12)", border: "rgba(71,85,105,0.3)", text: "#94a3b8" };
    if (coverageStatus === "closed")
      return { icon: <LockIcon size={13} color="#94a3b8" />, message: "Store closed", bg: "rgba(71,85,105,0.12)", border: "rgba(71,85,105,0.3)", text: "#94a3b8" };
    if (coverageStatus === "critical")
      return { icon: <WarningIcon size={13} color="#f87171" />, message: `Critically below coverage target — ${hereCount} here now`, bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.3)", text: "#f87171" };
    if (coverageStatus === "low")
      return { icon: <WarningIcon size={13} color="#fbbf24" />, message: `Below coverage target — ${hereCount} here now`, bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.3)", text: "#fbbf24" };
    // On target: a calm status rather than nothing, so the line is there in
    // every state and the dashboard under it never moves when it changes.
    return { icon: <TimeOffApprovedIcon size={13} color="#22c55e" />, message: `On target — ${hereCount} here now`, bg: "rgba(34,197,94,0.08)", border: "rgba(34,197,94,0.22)", text: "#22c55e", calm: true };
  })();

  const alertKey = alertConfig.message;
  // The status line always has its place (when alerts are on). Past/future
  // messages are known from the date; today's depends on the loaded data, so
  // until then the line is a placeholder of the same size.
  const showStatusLine = coverageAlertsEnabled;
  const statusPending = loading && !isPast && !isFuture;
  // Off today, "Back to Today" rides on the status line instead of being a
  // button that appears (and pushes the page) only when you leave today.
  const todayInStatusLine = showStatusLine && !isToday;

  // Mobile nav: full-width justify-between, pill-style date button, TODAY shortcut
  const mobileNav = (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <NavButton onClick={onPrev} label="Previous day">{prevArrow}</NavButton>
        <motion.button
          onClick={() => setPickerOpen(true)}
          aria-label={`${dateLabel}, ${dayName}. Open date picker`}
          aria-expanded={pickerOpen}
          aria-haspopup="dialog"
          whileHover={{ scale: 1.04, boxShadow: "0 0 16px rgba(99,102,241,0.25)" }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
          className="flex items-center gap-1.5 bg-slate-800/70 border border-slate-700/60 rounded-xl px-4 py-2.5 cursor-pointer"
        >
          <span className="text-base font-bold text-slate-100 tracking-tight">{dateLabel}</span>
          <motion.span
            animate={{ rotate: pickerOpen ? 180 : 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 22 }}
            className="inline-block"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-blue-500"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </motion.span>
        </motion.button>
        <NavButton onClick={onNext} label="Next day">{nextArrow}</NavButton>
      </div>
      {!isToday && !todayInStatusLine && (
        <motion.button
          onClick={onNow}
          whileHover={{ scale: 1.02, boxShadow: "0 0 20px rgba(99,102,241,0.35)" }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          className="w-full py-3 rounded-xl text-sm font-bold text-indigo-300 bg-indigo-500/10 border border-indigo-500/25 cursor-pointer"
          style={{ boxShadow: "0 0 12px rgba(99,102,241,0.12)" }}
        >
          Back to Today
        </motion.button>
      )}
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
    <div className="mb-4 desk:mb-6">
      {/* Desktop-only demo banner (above the bar) */}
      <DemoBanner className="hidden desk:flex" />

      {/*
       * Sticky on mobile (eliminates the JS-measured spacer div that was the main CLS source).
       * Static on desktop (content scrolls with the page in the desktop layout).
       * The `desk:contents` on the inner row makes brand + actions
       * become direct flex children of this bar on desktop, putting the date nav in the
       * centre between them.
       */}
      {/* Mobile-only bare date nav (when TopBar owns the header) */}
      {hideMobileBrand && (
        <div data-testid="mobile-date-nav" className="desk:hidden px-4 py-3 border-b border-slate-800">
          {mobileNav}
        </div>
      )}

      {/* Full header bar (desktop always; mobile only when brand is shown) */}
      <div
        className={`bg-bg border-b border-slate-800 px-4 pb-3
                   desk:static desk:flex
                   desk:items-center desk:gap-6
                   desk:px-6 desk:py-[14px]
                   ${hideMobileBrand ? "hidden desk:flex" : "sticky top-0 z-30 header-safe-top"}`}
      >
        {/* Mobile-only demo banner (inside bar) */}
        <DemoBanner className="-mx-4 mb-2 flex desk:hidden" />

        {/* Brand + actions row (mobile row-1; on desktop: contents trick merges into parent flex) */}
        <div className="flex items-center justify-between mb-3 desk:contents">
          {/* The wide size class shows the wordmark in SideNav, so skip it here */}
          <div className="desk:shrink-0 wide:hidden">
            <Logo className="h-6 desk:h-[22px]" />
            <div className="desk:hidden text-[11px] text-slate-400 mt-0.5">
              {dayName} · {dateLabel}
            </div>
          </div>

          {/* Desktop centred date nav — sits between brand and actions in the flex row */}
          <div className="hidden desk:flex flex-1 justify-center">
            {desktopNav}
          </div>

          <div className="flex items-center gap-2 desk:shrink-0">
            {/* Holds its room on today too (invisible there), so the date nav
                beside it doesn't re-center when you change days. */}
            <motion.button
              onClick={onNow}
              whileTap={{ scale: 0.93 }}
              whileHover={{ scale: 1.04 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              aria-hidden={isToday || undefined}
              tabIndex={isToday ? -1 : undefined}
              className={`text-[13px] font-bold text-slate-100 bg-slate-800 border border-slate-700 rounded-[10px] px-4 py-3 cursor-pointer ${isToday ? "invisible" : ""}`}
            >
              TODAY
            </motion.button>
            <NotificationBell />
            <UserMenu name={userName} onSignOut={onSignOut} onSignIn={onSignIn} />
          </div>
        </div>

        {/* Mobile-only date nav row (only when brand is in this bar) */}
        {!hideMobileBrand && (
          <div data-testid="mobile-date-nav" className="mb-1 desk:hidden">
            {mobileNav}
          </div>
        )}
      </div>

      {showStatusLine && (
        <div className="mt-3 tablet:mx-6 min-h-[38px]">
          <AnimatePresence mode="wait" initial={false}>
            {statusPending ? (
              <motion.div
                key="pending"
                role="status"
                aria-label="Loading coverage status"
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="skeleton h-[38px] rounded-[10px]"
              />
            ) : (
              <motion.div
                key={alertKey}
                role={alertConfig.calm ? "status" : undefined}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: [0.25, 0.46, 0.45, 0.94] }}
                className="min-h-[38px] px-[14px] py-[10px] rounded-[10px] text-xs flex items-center gap-2"
                style={{ background: alertConfig.bg, border: `1px solid ${alertConfig.border}`, color: alertConfig.text }}
              >
                {alertConfig.icon}
                <span className="flex-1 min-w-0">{alertConfig.message}</span>
                {todayInStatusLine && (
                  <button
                    onClick={onNow}
                    // A 22px chip inside the 38px line, with a 44px tap target.
                    className="relative -my-[3px] shrink-0 rounded-md bg-indigo-500/15 border border-indigo-500/30 px-2.5 py-0.5 text-xs font-bold leading-4 text-indigo-300 cursor-pointer hover:bg-indigo-500/25 transition-colors after:absolute after:-inset-y-[11px] after:-inset-x-1 after:content-['']"
                  >
                    Back to Today
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <DatePickerSheet open={pickerOpen} selected={date} today={today} onSelect={onDateSelect} onClose={() => setPickerOpen(false)} />
    </div>
  );
}
