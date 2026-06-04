"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion, LayoutGroup } from "framer-motion";

type NavItem = "team" | "schedule" | "clock" | "admin" | "settings" | "reports";

type Props = {
  active: NavItem;
  isManager?: boolean;
};

export default function SideNav({ active, isManager }: Props) {
  const searchParams = useSearchParams();
  const demo = searchParams.get("demo") === "true" ? "?demo=true" : "";

  return (
    <motion.aside
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] }}
      className="w-[220px] shrink-0 bg-[#0d1929] border-r border-slate-800 flex flex-col h-screen sticky top-0 z-20"
    >
      {/* Brand */}
      <div className="px-5 py-[18px] border-b border-slate-800 shrink-0">
        <span className="text-[22px] font-extrabold text-slate-100 tracking-tight">
          Shift
          <span className="bg-gradient-to-r from-blue-500 to-violet-500 bg-clip-text text-transparent">
            View
          </span>
        </span>
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5 overflow-y-auto">
        <LayoutGroup id="sidenav">
          <NavLink href={`/${demo}`} label="Team" isActive={active === "team"}>
            <TeamIcon />
          </NavLink>
          <NavLink href={`/schedule${demo}`} label="Schedule" isActive={active === "schedule"}>
            <ScheduleIcon />
          </NavLink>
          <NavLink href={`/clock${demo}`} label="Clock" isActive={active === "clock"}>
            <ClockIcon />
          </NavLink>

          <div className="h-px bg-slate-800 my-2" />

          {isManager && (
            <NavLink href={`/admin${demo}`} label="Admin" isActive={active === "admin"}>
              <AdminIcon />
            </NavLink>
          )}
          <NavLink href={`/settings${demo}`} label="Settings" isActive={active === "settings"}>
            <SettingsIcon />
          </NavLink>
          <NavLink href={`/reports${demo}`} label="Reports" isActive={active === "reports"}>
            <ReportsIcon />
          </NavLink>
        </LayoutGroup>
      </nav>
    </motion.aside>
  );
}

function NavLink({
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
      className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold border border-transparent transition-colors ${
        isActive
          ? "text-indigo-300"
          : "text-slate-400 hover:text-slate-200"
      }`}
    >
      {/* Animated active background pill */}
      {isActive && (
        <motion.div
          layoutId="sidenav-active"
          className="absolute inset-0 rounded-xl bg-indigo-600/20 border border-indigo-500/30"
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
        />
      )}
      {/* Hover background — uses Tailwind so it works in both themes */}
      {!isActive && (
        <span className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-slate-800" />
      )}

      {/* Icon + label */}
      <motion.span
        className="relative z-10 shrink-0"
        animate={{ scale: isActive ? 1.08 : 1 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
      >
        {children}
      </motion.span>
      <span className="relative z-10">{label}</span>

      {/* Active left accent line */}
      {isActive && (
        <motion.div
          layoutId="sidenav-accent"
          className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-indigo-400"
          transition={{ type: "spring", stiffness: 380, damping: 32 }}
        />
      )}
    </Link>
  );
}

function TeamIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="9" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="15" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 20c0-3.866 2.686-7 6-7h6c3.314 0 6 3.134 6 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ScheduleIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="5" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AdminIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 2L3 7v5c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V7L12 2z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ReportsIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M18 20V10M12 20V4M6 20v-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
