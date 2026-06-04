"use client";

import SideNav from "./SideNav";
import TopBar from "./TopBar";

export type NavItem = "team" | "schedule" | "clock" | "admin" | "settings" | "reports";

type Props = {
  active: NavItem;
  isManager?: boolean;
  /** When provided, a persistent TopBar is rendered above the animated content on mobile. */
  userName?: string | null;
  isDemo?: boolean;
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
  onSignOut,
  onSignIn,
  children,
}: Props) {
  const showTopBar = onSignOut !== undefined || onSignIn !== undefined;

  return (
    <div className="[@media(min-width:900px)]:flex min-h-screen bg-bg">
      <div className="hidden [@media(min-width:900px)]:block">
        <SideNav active={active} isManager={isManager} />
      </div>

      {/* Wrapper keeps TopBar + content in a single flex column on desktop */}
      <div className="[@media(min-width:900px)]:flex-1 [@media(min-width:900px)]:overflow-y-auto min-w-0">
        {/* TopBar sits outside the fade animation so it never visually reloads */}
        {showTopBar && (
          <TopBar
            userName={userName ?? null}
            isDemo={isDemo ?? false}
            onSignOut={onSignOut}
            onSignIn={onSignIn}
          />
        )}

        <div>{children}</div>
      </div>
    </div>
  );
}
