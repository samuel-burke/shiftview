"use client";

import NotificationBell from "./NotificationBell";
import UserMenu from "./UserMenu";
import ClockStatusBadge from "./ClockStatusBadge";
import Logo from "@/components/Logo";
import DemoBanner from "./DemoBanner";

type Props = {
  userName: string | null;
  onBack?: () => void;
  onSignOut?: () => void;
  onSignIn?: () => void;
};

export default function TopBar({ userName, onBack, onSignOut, onSignIn }: Props) {
  return (
    <div data-sticky-header className="desk:hidden sticky top-0 z-30 bg-bg border-b border-slate-800">
      {/* The demo strip takes the safe-area inset when it shows (CSS, so the
          header is right from the first frame; see DemoBanner). */}
      <DemoBanner style={{ paddingTop: "calc(env(safe-area-inset-top) + 6px)" }} />
      <div className="topbar-row flex items-center justify-between px-4 pb-3">
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
        <Logo className="h-6" />
        <div className="flex items-center gap-2">
          <ClockStatusBadge />
          <NotificationBell />
          <UserMenu name={userName} onSignOut={onSignOut} onSignIn={onSignIn} />
        </div>
      </div>
    </div>
  );
}
