"use client";

import { useState, useRef, useEffect } from "react";
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

  const dateNav = (
    <div className={`flex items-center ${isDesktop ? "gap-4" : "justify-between"}`}>
      <button onClick={onPrev} aria-label="Previous day" className={navBtn}>←</button>
      <button
        onClick={() => setPickerOpen(true)}
        className={`text-center bg-transparent border-none cursor-pointer ${isDesktop ? "px-2" : "p-0"}`}
      >
        <div className={`font-extrabold text-slate-100 tracking-tight flex items-center gap-1.5 ${isDesktop ? "text-lg" : "text-2xl"}`}>
          {dateLabel}
          <span className="text-[13px] text-blue-500 font-normal">▾</span>
        </div>
        <div className="text-[13px] text-slate-400 mt-0.5">
          {dayName}
          {isToday && isDesktop && <span className="ml-2 text-slate-400">· {timeStr}</span>}
        </div>
        {isToday && !isDesktop && (
          <div className="text-[11px] text-slate-400 mt-0.5">Live: {timeStr}</div>
        )}
      </button>
      <button onClick={onNext} aria-label="Next day" className={navBtn}>→</button>
    </div>
  );

  // ── Desktop layout ──────────────────────────────────────────────────────────
  if (isDesktop) {
    return (
      <div className="mb-6">
        <div className="bg-bg border-b border-slate-800 px-6 py-[14px] flex items-center gap-6">
          {/* Date nav — left-aligned, no brand (SideNav owns it) */}
          <div className="flex-1">
            {dateNav}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {!isToday && (
              <button onClick={onNow} className={actionBtn}>TODAY</button>
            )}
            {!isDemo && <NotificationBell />}
            <UserMenu name={userName} isManager={isManager} onSignOut={onSignOut} onSignIn={onSignIn} />
          </div>
        </div>

        {alertConfig && !loading && (
          <div
            className="mx-6 mt-3 px-[14px] py-[10px] rounded-[10px] text-xs flex items-center gap-2"
            style={{ background: alertConfig.bg, border: `1px solid ${alertConfig.border}`, color: alertConfig.text }}
          >
            {alertConfig.icon}
            <span>{alertConfig.message}</span>
          </div>
        )}

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
        <div className="flex items-center justify-between mb-3">
          <span className="text-2xl font-extrabold text-slate-100 tracking-tight">
            Shift
            <span className="bg-gradient-to-r from-blue-500 to-violet-500 bg-clip-text text-transparent">View</span>
          </span>
          <div className="flex items-center gap-2">
            {!isToday && (
              <button onClick={onNow} className="text-[13px] font-bold text-slate-100 bg-slate-700 border-none rounded-[10px] px-4 py-2 cursor-pointer">TODAY</button>
            )}
            {!isDemo && <NotificationBell />}
            <UserMenu name={userName} isManager={isManager} onSignOut={onSignOut} onSignIn={onSignIn} />
          </div>
        </div>
        <div className="mb-1">{dateNav}</div>
      </div>

      <div style={{ height: barHeight }} />

      {alertConfig && !loading && (
        <div
          className="mt-3 px-[14px] py-[10px] rounded-[10px] text-xs flex items-center gap-2"
          style={{ background: alertConfig.bg, border: `1px solid ${alertConfig.border}`, color: alertConfig.text }}
        >
          {alertConfig.icon}
          <span>{alertConfig.message}</span>
        </div>
      )}

      <DatePickerSheet open={pickerOpen} selected={date} today={today} onSelect={onDateSelect} onClose={() => setPickerOpen(false)} />
    </div>
  );
}

const navBtn = "size-9 rounded-full bg-slate-800 border border-slate-700 text-slate-400 text-base cursor-pointer flex items-center justify-center shrink-0";

const actionBtn = "text-[13px] font-bold text-slate-100 bg-slate-800 border border-slate-700 rounded-[10px] px-[14px] py-2 cursor-pointer";
