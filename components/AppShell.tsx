"use client";

import { motion } from "framer-motion";
import SideNav from "./SideNav";

export type NavItem = "team" | "schedule" | "clock" | "admin" | "settings" | "reports";

type Props = {
  active: NavItem;
  isManager?: boolean;
  children: React.ReactNode;
};

/*
 * Uses CSS media queries instead of a JS hook so the layout is correct on the
 * server-rendered HTML. A JS hook would initialize to false, then flip to true
 * on desktop after hydration — causing a large layout shift (CLS).
 */
export default function AppShell({ active, isManager, children }: Props) {
  return (
    <div className="[@media(min-width:900px)]:flex min-h-screen bg-bg">
      <div className="hidden [@media(min-width:900px)]:block">
        <SideNav active={active} isManager={isManager} />
      </div>
      <motion.div
        className="[@media(min-width:900px)]:flex-1 min-w-0 [@media(min-width:900px)]:overflow-y-auto"
        initial={{ opacity: 0, x: 8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, delay: 0.1, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        {children}
      </motion.div>
    </div>
  );
}
