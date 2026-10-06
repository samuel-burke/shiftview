"use client";

import Link from "next/link";
import { motion, LayoutGroup } from "framer-motion";
import ClockStatusBadge from "./ClockStatusBadge";
import type { NavItem } from "./AppShell";
import {
  TeamIcon,
  ScheduleIcon,
  ClockIcon,
  PlannerIcon,
  AdminIcon,
  SettingsIcon,
  ReportsIcon,
  WeekGridIcon,
  RequestsIcon,
} from "./SideNav";

type Props = {
  active: NavItem;
  isManager?: boolean;
};

/*
 * 72px icon rail for the tablet and desk size classes (600–1439px). Shows every
 * destination — the phone's bottom tabs only fit three — while using a fraction
 * of the full SideNav's width. The wide size class swaps it for SideNav.
 */
export default function NavRail({ active, isManager }: Props) {
  return (
    <div
      role="complementary"
      data-testid="nav-rail"
      className="w-[72px] shrink-0 bg-bg border-r border-slate-800 flex flex-col items-center h-screen sticky top-0 z-20"
      style={{
        paddingTop: "env(safe-area-inset-top)",
        paddingLeft: "env(safe-area-inset-left)",
        boxSizing: "content-box",
      }}
    >
      <Link
        href="/"
        aria-label="ShiftView home"
        className="mt-4 mb-2 text-[17px] font-extrabold tracking-tight text-slate-100"
      >
        S<span className="bg-gradient-to-r from-blue-500 to-violet-500 bg-clip-text text-transparent">V</span>
      </Link>

      <div className="mb-3 h-4 flex items-center" data-testid="rail-clock-status">
        <ClockStatusBadge variant="dot" />
      </div>

      <nav aria-label="Main navigation" className="flex-1 w-full px-2 flex flex-col items-stretch gap-1 overflow-y-auto pb-4">
        <LayoutGroup id="navrail">
          <RailLink href="/" label="Team" isActive={active === "team"}><TeamIcon size={20} /></RailLink>
          <RailLink href="/schedule" label="Schedule" isActive={active === "schedule"}><ScheduleIcon size={20} /></RailLink>
          <RailLink href="/clock" label="Clock" isActive={active === "clock"}><ClockIcon size={20} /></RailLink>

          <div className="h-px bg-slate-800 my-1.5 mx-2" />

          {isManager && (
            <RailLink href="/week" label="Week" isActive={active === "week"}><WeekGridIcon size={20} /></RailLink>
          )}
          {isManager && (
            <RailLink href="/requests" label="Requests" isActive={active === "requests"}><RequestsIcon size={20} /></RailLink>
          )}
          {isManager && (
            <RailLink href="/draft" label="Planner" isActive={active === "planner"}><PlannerIcon size={20} /></RailLink>
          )}
          {isManager && (
            <RailLink href="/admin" label="Admin" isActive={active === "admin"}><AdminIcon size={20} /></RailLink>
          )}
          <RailLink href="/reports" label="Reports" isActive={active === "reports"}><ReportsIcon size={20} /></RailLink>
          <RailLink href="/settings" label="Settings" isActive={active === "settings"}><SettingsIcon size={20} /></RailLink>
        </LayoutGroup>
      </nav>
    </div>
  );
}

function RailLink({
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
      className={`group relative flex flex-col items-center gap-1 rounded-xl py-2 min-h-[52px] justify-center transition-colors ${
        isActive ? "text-indigo-300" : "text-slate-400 hover:text-slate-200"
      }`}
    >
      {isActive && (
        <motion.div
          layoutId="navrail-active"
          className="absolute inset-0 rounded-xl bg-indigo-600/20 border border-indigo-500/30"
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
        />
      )}
      {!isActive && (
        <span className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-slate-800" />
      )}
      <span className="relative z-10">{children}</span>
      <span className="relative z-10 text-[10px] font-semibold leading-none">{label}</span>
    </Link>
  );
}
