"use client";

import { motion } from "framer-motion";
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
      <motion.div
        className="flex-1 min-w-0 overflow-y-auto"
        initial={{ opacity: 0, x: 8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        {children}
      </motion.div>
    </div>
  );
}
