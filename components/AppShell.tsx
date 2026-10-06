"use client";

import SideNav from "./SideNav";
import NavRail from "./NavRail";
import TopBar from "./TopBar";

export type NavItem = "team" | "schedule" | "clock" | "admin" | "settings" | "reports" | "planner" | "week";

type Props = {
  active: NavItem;
  isManager?: boolean;
  /** When provided, a persistent TopBar is rendered above the animated content on mobile. */
  userName?: string | null;
  isDemo?: boolean;
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
  isDemo,
  onBack,
  onSignOut,
  onSignIn,
  children,
}: Props) {
  const showTopBar = onSignOut !== undefined || onSignIn !== undefined;

  return (
    <div className="tablet:flex min-h-screen bg-bg">
      {/* compact: BottomNav (rendered by each page) · tablet/desk: icon rail · wide: full sidebar */}
      <div className="hidden tablet:block wide:hidden">
        <NavRail active={active} isManager={isManager} />
      </div>
      <div className="hidden wide:block">
        <SideNav active={active} isManager={isManager} />
      </div>

      {/* Wrapper keeps TopBar + content in a single flex column beside the nav */}
      <div className="tablet:flex-1 desk:overflow-y-auto min-w-0">
        {/* TopBar sits outside the fade animation so it never visually reloads */}
        {showTopBar && (
          <TopBar
            userName={userName ?? null}
            isDemo={isDemo ?? false}
            onBack={onBack}
            onSignOut={onSignOut}
            onSignIn={onSignIn}
          />
        )}

        <div>{children}</div>
      </div>
    </div>
  );
}
