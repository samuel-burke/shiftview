"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { CoverageStatus } from "../data/types";
import DatePickerSheet from "./DatePickerSheet";
import UserMenu from "./UserMenu";
import NotificationBell from "./NotificationBell";
import { WarningIcon, CalendarIcon, LockIcon, TimeOffApprovedIcon } from "./ShiftIcons";
import Logo from "@/components/Logo";
import DemoBanner from "./DemoBanner";
import { tint } from "@/lib/theme-colors";

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
      whileHover={{ scale: 1.08, boxShadow: `0 0 12px ${tint("var(--color-accent)", 25)}` }}
      transition={{ type: "spring", stiffness: 450, damping: 25 }}
      className="size-11 rounded-full bg-fill border border-line-strong text-fg-muted text-base cursor-pointer flex items-center justify-center shrink-0"
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
      return { icon: <CalendarIcon size={13} color="var(--status-muted)" />, message: isPast ? "Viewing past schedule" : "Viewing future schedule", bg: tint("var(--status-muted)", 12), border: tint("var(--status-muted)", 30), text: "var(--status-muted)" };
    if (coverageStatus === "closed")
      return { icon: <LockIcon size={13} color="var(--status-muted)" />, message: "Store closed", bg: tint("var(--status-muted)", 12), border: tint("var(--status-muted)", 30), text: "var(--status-muted)" };
    if (coverageStatus === "critical")
      return { icon: <WarningIcon size={13} color="var(--status-bad)" />, message: `Critically below coverage target — ${hereCount} here now`, bg: tint("var(--color-danger)", 12), border: tint("var(--color-danger)", 30), text: "var(--status-bad)" };
    if (coverageStatus === "low")
      return { icon: <WarningIcon size={13} color="var(--status-caution)" />, message: `Below coverage target — ${hereCount} here now`, bg: tint("var(--color-warning)", 12), border: tint("var(--color-warning)", 30), text: "var(--status-caution)" };
    // On target: a calm status rather than nothing, so the line is there in
    // every state and the dashboard under it never moves when it changes.
    return { icon: <TimeOffApprovedIcon size={13} color="var(--status-ok-mark)" />, message: `On target — ${hereCount} here now`, bg: tint("var(--color-ok)", 8), border: tint("var(--color-ok)", 22), text: "var(--status-ok)", calm: true };
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
          whileHover={{ scale: 1.04, boxShadow: `0 0 16px ${tint("var(--color-accent)", 25)}` }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
          className="flex items-center gap-1.5 h-11 bg-fill/70 border border-line-strong/60 rounded-xl px-4 cursor-pointer"
        >
          <span className="text-base font-bold text-fg tracking-tight">{dateLabel}</span>
          <motion.span
            animate={{ rotate: pickerOpen ? 180 : 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 22 }}
            className="inline-block"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-info-fg"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </motion.span>
        </motion.button>
        <NavButton onClick={onNext} label="Next day">{nextArrow}</NavButton>
      </div>
      {!isToday && !todayInStatusLine && (
        <motion.button
          onClick={onNow}
          whileHover={{ scale: 1.02, boxShadow: `0 0 20px ${tint("var(--color-accent)", 35)}` }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          className="w-full py-3 rounded-xl text-sm font-bold text-accent-fg-strong bg-accent/10 border border-accent/25 cursor-pointer"
          style={{ boxShadow: `0 0 12px ${tint("var(--color-accent)", 12)}` }}
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
        <div className="text-lg font-extrabold text-fg tracking-tight flex items-center gap-1.5">
          {dateLabel}
          <span className="text-[13px] text-info-fg font-normal">▾</span>
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
        <div data-testid="mobile-date-nav" className="desk:hidden px-4 py-3 border-b border-line">
          {mobileNav}
        </div>
      )}

      {/* Full header bar (desktop always; mobile only when brand is shown) */}
      <div
        className={`bg-bg border-b border-line px-4 pb-3
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
            <div className="desk:hidden text-[11px] text-fg-muted mt-0.5">
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
              className={`text-[13px] font-bold text-fg bg-fill border border-line-strong rounded-[10px] px-4 py-3 cursor-pointer ${isToday ? "invisible" : ""}`}
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
        <div className="mt-3 mx-4 tablet:mx-6 min-h-[38px]">
          {/* A new status replaces the old one at once and fades in. No exit
              animation: AnimatePresence's "wait" mode could stall on one when
              the status changed twice in quick succession (today's status
              landing just as the user stepped to another day), leaving the
              old message on screen and no Back to Today. */}
          {statusPending ? (
            <div
              role="status"
              aria-label="Loading coverage status"
              className="skeleton h-[38px] rounded-[10px]"
            />
          ) : (
            <motion.div
              key={alertKey}
              role={alertConfig.calm ? "status" : undefined}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
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
                  className="relative -my-[3px] shrink-0 rounded-md bg-accent/15 border border-accent/30 px-2.5 py-0.5 text-xs font-bold leading-4 text-accent-fg-strong cursor-pointer hover:bg-accent/25 transition-colors after:absolute after:-inset-y-[11px] after:-inset-x-1 after:content-['']"
                >
                  Back to Today
                </button>
              )}
            </motion.div>
          )}
        </div>
      )}

      <DatePickerSheet open={pickerOpen} selected={date} today={today} onSelect={onDateSelect} onClose={() => setPickerOpen(false)} />
    </div>
  );
}
