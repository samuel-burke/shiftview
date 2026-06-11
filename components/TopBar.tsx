"use client";

import { useState, useEffect } from "react";
import NotificationBell from "./NotificationBell";
import UserMenu from "./UserMenu";

type Props = {
  userName: string | null;
  isDemo: boolean;
  onBack?: () => void;
  onSignOut?: () => void;
  onSignIn?: () => void;
};

export default function TopBar({ userName, isDemo, onBack, onSignOut, onSignIn }: Props) {
  const [todayStr, setTodayStr] = useState("");

  useEffect(() => {
    setTodayStr(
      new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    );
  }, []);

  return (
    <div className="[@media(min-width:900px)]:hidden sticky top-0 z-30 bg-bg border-b border-slate-800">
      {isDemo && (
        <div
          className="px-4 pb-1.5 bg-blue-500/8 border-b border-blue-500/15 flex items-center justify-between"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 6px)" }}
        >
          <span className="text-[11px] text-blue-400/80 font-medium">Demo Mode · Sample data resets nightly</span>
          <a href="/login" className="text-[11px] font-bold text-blue-400">Sign In →</a>
        </div>
      )}
      <div
        className="flex items-center justify-between px-4 pb-3"
        style={{ paddingTop: isDemo ? "14px" : "calc(env(safe-area-inset-top) + 14px)" }}
      >
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Back"
            className="size-11 rounded-xl bg-card border border-slate-800 text-slate-400 flex items-center justify-center cursor-pointer shrink-0 hover:bg-slate-800 hover:text-slate-200 transition-colors mr-1"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
        <span className="text-2xl font-extrabold text-slate-100 tracking-tight">
          Shift
          <span className="bg-gradient-to-r from-blue-500 to-violet-500 bg-clip-text text-transparent">
            View
          </span>
        </span>
        <div className="flex items-center gap-2">
          {todayStr && <span className="text-sm text-slate-400">{todayStr}</span>}
          <NotificationBell />
          <UserMenu name={userName} onSignOut={onSignOut} onSignIn={onSignIn} />
        </div>
      </div>
    </div>
  );
}
