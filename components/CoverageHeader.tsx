"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CoverageStatus } from "../data/types";
import DatePickerSheet from "./DatePickerSheet";
import UserMenu from "./UserMenu";
import NotificationBell from "./NotificationBell";
import { useIsDesktop } from "../hooks/useIsDesktop";
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
}: Props) {
  const isDesktop = useIsDesktop();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [barHeight, setBarHeight] = useState(0);
  const topBarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isDesktop || !topBarRef.current) return;
    const ro = new ResizeObserver(() => {
      if (topBarRef.current) setBarHeight(topBarRef.current.offsetHeight);
    });
    ro.observe(topBarRef.current);
    setBarHeight(topBarRef.current.offsetHeight);
    return () => ro.disconnect();
  }, [isDesktop]);

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

  const dateNav = (
    <div className={`flex items-center ${isDesktop ? "gap-4" : "justify-between"}`}>
      <NavButton onClick={onPrev} label="Previous day">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </NavButton>
      <motion.button
        onClick={() => setPickerOpen(true)}
        aria-label={`${dateLabel}, ${dayName}. Open date picker`}
        aria-expanded={pickerOpen}
        aria-haspopup="dialog"
        whileTap={{ scale: 0.97 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        className={`text-center bg-transparent border-none cursor-pointer ${isDesktop ? "px-2" : "p-0"}`}
      >
        <div className={`font-extrabold text-slate-100 tracking-tight flex items-center gap-1.5 ${isDesktop ? "text-lg" : "text-2xl"}`}>
          {dateLabel}
          <motion.span
            animate={{ rotate: pickerOpen ? 180 : 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 22 }}
            className="inline-block"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-blue-500"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </motion.span>
        </div>
        <div className="text-[13px] text-slate-400 mt-0.5">
          {dayName}
          {isToday && isDesktop && <span className="ml-2 text-slate-400">· {timeStr}</span>}
        </div>
        {isToday && !isDesktop && (
          <div className="text-[11px] text-slate-400 mt-0.5">Live: {timeStr}</div>
        )}
      </motion.button>
      <NavButton onClick={onNext} label="Next day">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
      </NavButton>
    </div>
  );

  const demoBanner = isDemo && (
    <div className="bg-blue-500/8 border-b border-blue-500/15 px-4 py-1.5 flex items-center justify-between">
      <span className="text-[11px] text-blue-400/80 font-medium">Demo Mode · Changes are not saved</span>
      <a href="/login" className="text-[11px] font-bold text-blue-400 hover:text-blue-300 transition-colors">Sign In →</a>
    </div>
  );

  const alertBanner = !loading && (
    <AnimatePresence mode="wait">
      {alertConfig && (
        <motion.div
          key={alertKey}
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.98 }}
          transition={{ duration: 0.22, ease: [0.25, 0.46, 0.45, 0.94] }}
          className={`px-[14px] py-[10px] rounded-[10px] text-xs flex items-center gap-2 ${isDesktop ? "mx-6 mt-3" : "mt-3"}`}
          style={{ background: alertConfig.bg, border: `1px solid ${alertConfig.border}`, color: alertConfig.text }}
        >
          {alertConfig.icon}
          <span>{alertConfig.message}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // ── Desktop layout ──────────────────────────────────────────────────────────
  if (isDesktop) {
    return (
      <div className="mb-6">
        {demoBanner}
        <div className="bg-bg border-b border-slate-800 px-6 py-[14px] flex items-center gap-6">
          {/* Date nav — centered */}
          <div className="flex-1 flex justify-center">
            {dateNav}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
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

        {alertBanner}

        <DatePickerSheet open={pickerOpen} selected={date} today={today} onSelect={onDateSelect} onClose={() => setPickerOpen(false)} />
      </div>
    );
  }

  // ── Mobile layout ───────────────────────────────────────────────────────────
  return (
    <div className="mb-4">
      <div
        ref={topBarRef}
        className="fixed top-0 left-0 right-0 z-30 bg-bg border-b border-slate-800 max-w-[480px] mx-auto px-4 pb-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 12px)" }}
      >
        {isDemo && (
          <div className="-mx-4 mb-2 px-4 py-1.5 bg-blue-500/8 border-b border-blue-500/15 flex items-center justify-between">
            <span className="text-[11px] text-blue-400/80 font-medium">Demo Mode · Changes are not saved</span>
            <a href="/login" className="text-[11px] font-bold text-blue-400 hover:text-blue-300 transition-colors">Sign In →</a>
          </div>
        )}
        <div className="flex items-center justify-between mb-3">
          {/* Animated gradient logo on mobile (matches desktop) */}
          <span className="text-2xl font-extrabold text-slate-100 tracking-tight">
            Shift
            <span
              className="bg-clip-text text-transparent animate-gradient"
              style={{ backgroundImage: "linear-gradient(90deg, #3b82f6, #22d3ee, #a78bfa, #3b82f6)", backgroundSize: "200% auto" }}
            >
              View
            </span>
          </span>
          <div className="flex items-center gap-2">
            {!isToday && (
              <motion.button
                onClick={onNow}
                whileTap={{ scale: 0.93 }}
                whileHover={{ scale: 1.04 }}
                transition={{ type: "spring", stiffness: 400, damping: 25 }}
                className="text-[13px] font-bold text-slate-100 bg-slate-700 border-none rounded-[10px] px-4 py-2.5 cursor-pointer hover:bg-slate-600 transition-colors"
              >
                TODAY
              </motion.button>
            )}
            {!isDemo && <NotificationBell />}
            <UserMenu name={userName} isManager={isManager} onSignOut={onSignOut} onSignIn={onSignIn} />
          </div>
        </div>
        <div className="mb-1">{dateNav}</div>
      </div>

      <div style={{ height: barHeight }} />

      {alertBanner}

      <DatePickerSheet open={pickerOpen} selected={date} today={today} onSelect={onDateSelect} onClose={() => setPickerOpen(false)} />
    </div>
  );
}
