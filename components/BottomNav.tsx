"use client";

import Link from "next/link";
import type { NavItem } from "./AppShell";
import { motion } from "framer-motion";
import { haptic } from "../lib/haptic";

type Props = {
  active: NavItem;
};

const TABS = ["team", "schedule", "clock"] as const;

export default function BottomNav({ active }: Props) {
  const tabIndex = (TABS as readonly NavItem[]).indexOf(active);

  return (
    <nav
      aria-label="Main navigation"
      /*
       * Opaque background, no backdrop-filter: on iOS Safari an element that is
       * both `position: fixed` and has a backdrop-filter intermittently loses
       * its fixed positioning and scrolls/floats with the page. The bar was
       * already 95% opaque, so dropping the blur for a solid bg is a no-op
       * visually but keeps the nav reliably pinned to the bottom.
       */
      className="[@media(min-width:900px)]:hidden fixed bottom-0 left-0 right-0 z-30 bg-bg border-t border-slate-800/80 max-w-[480px] mx-auto"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex relative">
        {/* Pill — snaps instantly to the active tab */}
        <div
          aria-hidden="true"
          className="absolute top-0 h-[2px] pointer-events-none flex justify-center"
          style={{ width: "33.333%", left: `${tabIndex * 33.333}%` }}
        >
          <div
            className="h-full w-8 rounded-full"
            style={{
              background: "linear-gradient(90deg, #818cf8, #6366f1)",
              boxShadow: "0 0 10px #6366f1aa, 0 0 20px #6366f155",
            }}
          />
        </div>

        <NavTab href="/" label="Team" isActive={active === "team"}>
          <TeamIcon />
        </NavTab>
        <NavTab href="/schedule" label="Schedule" isActive={active === "schedule"}>
          <ScheduleIcon />
        </NavTab>
        <NavTab href="/clock" label="Clock" isActive={active === "clock"}>
          <ClockIcon />
        </NavTab>
      </div>
    </nav>
  );
}

function NavTab({
  href,
  label,
  isActive,
  children,
}: {
  href: string;
  label: string;
  isActive: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`flex-1 flex flex-col items-center pt-3 pb-2 gap-0.5 transition-colors duration-200 ${isActive ? "text-slate-100" : "text-slate-500"}`}
      onClick={() => { if (!isActive) haptic(6); }}
    >
      <motion.div
        animate={{
          scale: isActive ? 1.12 : 1,
          filter: isActive ? "drop-shadow(0 0 6px rgba(129,140,248,0.6))" : "none",
        }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
      >
        {children}
      </motion.div>
      <motion.span
        animate={{ opacity: isActive ? 1 : 0.6 }}
        className="text-[10px] font-semibold tracking-wider uppercase"
      >
        {label}
      </motion.span>
    </Link>
  );
}

function TeamIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="9" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="15" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 20c0-3.866 2.686-7 6-7h6c3.314 0 6 3.134 6 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ScheduleIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
