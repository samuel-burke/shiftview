"use client";

import Link from "next/link";
import type { NavItem } from "./AppShell";
import { motion } from "framer-motion";
import { haptic } from "../lib/haptic";
import { tint } from "@/lib/theme-colors";

type Props = {
  active: NavItem;
};

export default function BottomNav({ active }: Props) {
  return (
    <motion.nav
      aria-label="Main navigation"
      data-testid="bottom-nav"
      /*
       * Opaque background, no backdrop-filter: on iOS Safari an element that is
       * both `position: fixed` and has a backdrop-filter intermittently loses
       * its fixed positioning and scrolls/floats with the page. The bar was
       * already 95% opaque, so dropping the blur for a solid bg is a no-op
       * visually but keeps the nav reliably pinned to the bottom.
       *
       * layoutScroll on a fixed element makes framer measure the pill against
       * the viewport rather than the page; otherwise leaving a scrolled page
       * (navigation scrolls back to the top) slides the pill in from below.
       */
      layoutScroll
      className="tablet:hidden fixed bottom-0 left-0 right-0 z-30 bg-bg border-t border-line/80 max-w-[480px] mx-auto"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex">
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
    </motion.nav>
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
      className={`relative flex-1 flex flex-col items-center pt-3 pb-2 gap-0.5 transition-colors duration-200 ${isActive ? "text-fg" : "text-fg-subtle"}`}
      onClick={() => { if (!isActive) haptic(6); }}
    >
      {/* Pill — each page mounts its own bar, and the shared layoutId slides
          it over from the previous page's tab (none on pages without a tab). */}
      {isActive && (
        <div aria-hidden="true" className="absolute top-0 inset-x-0 flex justify-center pointer-events-none">
          <motion.div
            layoutId="bottomnav-pill"
            className="h-[2px] w-8 rounded-full"
            style={{
              background: "linear-gradient(90deg, var(--color-accent-fg), var(--color-accent))",
              boxShadow: `0 0 10px ${tint("var(--color-accent)", 67)}, 0 0 20px ${tint("var(--color-accent)", 33)}`,
            }}
            transition={{ type: "spring", stiffness: 380, damping: 32 }}
          />
        </div>
      )}
      {/* Only the scale animates (a transform); the glow just switches. */}
      <motion.div
        animate={{ scale: isActive ? 1.12 : 1 }}
        style={{ filter: isActive ? `drop-shadow(0 0 6px ${tint("var(--color-accent-fg)", 60)})` : "none" }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
      >
        {children}
      </motion.div>
      {/* Inactive tabs are told apart by color alone (slate-500, 4.5:1), not
          faded on top of it: at 60% opacity the label fell to ~2.3:1. */}
      <span className="text-[10px] font-semibold tracking-wider uppercase">
        {label}
      </span>
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
