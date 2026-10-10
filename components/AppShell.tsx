"use client";

import { useState } from "react";
import { MotionConfig } from "framer-motion";
import SideNav from "./SideNav";
import NavRail from "./NavRail";
import TopBar from "./TopBar";
import KeyboardShortcuts from "./KeyboardShortcuts";
import AddToHomeScreenBanner from "./AddToHomeScreenBanner";
import { useSidebarExpanded } from "@/hooks/useSidebarExpanded";

export type NavItem = "team" | "schedule" | "clock" | "admin" | "settings" | "reports" | "week" | "requests";

type Props = {
  active: NavItem;
  isManager?: boolean;
  /** When provided, a persistent TopBar is rendered above the animated content on mobile. */
  userName?: string | null;
  onBack?: () => void;
  onSignOut?: () => void;
  onSignIn?: () => void;
  children: React.ReactNode;
};

/*
 * Uses CSS media queries instead of a JS hook so the layout is correct on the
 * server-rendered HTML. A JS hook would initialize to false, then flip to true
 * on desktop after hydration — causing a large layout shift (CLS).
 */
export default function AppShell({
  active,
  isManager,
  userName,
  onBack,
  onSignOut,
  onSignIn,
  children,
}: Props) {
  const showTopBar = onSignOut !== undefined || onSignIn !== undefined;
  // Desk-size screens can swap the rail for the full sidebar; remembered per device.
  const [sidebarExpanded, setSidebarExpanded] = useSidebarExpanded();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // reducedMotion="user": with the system's reduce-motion setting on, every
  // framer animation in the app drops its movement (CSS ones are handled in
  // globals.css).
  return (
    <MotionConfig reducedMotion="user">
    <div className="tablet:flex min-h-dvh bg-bg">
      {/*
       * compact: BottomNav (rendered by each page) · tablet: icon rail ·
       * desk: icon rail, or the full sidebar when expanded · wide: full sidebar
       */}
      <div className={`hidden tablet:block wide:hidden ${sidebarExpanded ? "desk:hidden" : ""}`}>
        <NavRail active={active} isManager={isManager} onExpand={() => setSidebarExpanded(true)} />
      </div>
      <div className={`hidden wide:block ${sidebarExpanded ? "desk:block" : ""}`}>
        <SideNav
          active={active}
          isManager={isManager}
          onCollapse={() => setSidebarExpanded(false)}
          onShowShortcuts={() => setShortcutsOpen(true)}
        />
      </div>
      <KeyboardShortcuts active={active} open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      {/* Wrapper keeps TopBar + content in a single flex column beside the nav */}
      <div className="tablet:flex-1 desk:overflow-y-auto min-w-0">
        {/* TopBar sits outside the fade animation so it never visually reloads */}
        {showTopBar && (
          <TopBar
            userName={userName ?? null}
            onBack={onBack}
            onSignOut={onSignOut}
            onSignIn={onSignIn}
          />
        )}

        <div>{children}</div>
      </div>
      <AddToHomeScreenBanner />
    </div>
    </MotionConfig>
  );
}
