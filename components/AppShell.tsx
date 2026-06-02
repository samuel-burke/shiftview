"use client";

import SideNav from "./SideNav";
import { useIsDesktop } from "../hooks/useIsDesktop";

export type NavItem = "team" | "schedule" | "clock" | "admin" | "settings" | "reports";

type Props = {
  active: NavItem;
  isManager?: boolean;
  children: React.ReactNode;
};

export default function AppShell({ active, isManager, children }: Props) {
  const isDesktop = useIsDesktop();

  if (!isDesktop) return <>{children}</>;

  return (
    <div className="flex min-h-screen bg-bg">
      <SideNav active={active} isManager={isManager} />
      <div className="flex-1 min-w-0 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
