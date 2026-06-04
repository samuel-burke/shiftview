"use client";

import { useState, useEffect } from "react";
import NotificationBell from "./NotificationBell";
import UserMenu from "./UserMenu";

type Props = {
  userName: string | null;
  isDemo: boolean;
  onSignOut?: () => void;
  onSignIn?: () => void;
};

export default function TopBar({ userName, isDemo, onSignOut, onSignIn }: Props) {
  const [todayStr, setTodayStr] = useState("");

  useEffect(() => {
    setTodayStr(
      new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    );
  }, []);

  return (
    <div
      className="[@media(min-width:900px)]:hidden sticky top-0 z-30 flex items-center justify-between px-4 pb-3 border-b border-slate-800 bg-bg"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}
    >
      <span className="text-2xl font-extrabold text-slate-100 tracking-tight">
        Shift
        <span
          className="bg-clip-text text-transparent animate-gradient"
          style={{
            backgroundImage: "linear-gradient(90deg, #3b82f6, #22d3ee, #a78bfa, #3b82f6)",
            backgroundSize: "200% auto",
          }}
        >
          View
        </span>
      </span>
      <div className="flex items-center gap-2">
        {todayStr && <span className="text-sm text-slate-400">{todayStr}</span>}
        {!isDemo && <NotificationBell />}
        <UserMenu name={userName} onSignOut={onSignOut} onSignIn={onSignIn} />
      </div>
    </div>
  );
}
