"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useIsDesktop } from "../hooks/useIsDesktop";
import type { NavItem } from "./AppShell";
import { motion } from "framer-motion";
import { useState, useEffect } from "react";

type Props = {
  active: NavItem;
};

const TABS = ["team", "schedule", "clock"] as const;
const STORAGE_KEY = "nav-prev-tab";

export default function BottomNav({ active }: Props) {
  const isDesktop = useIsDesktop();
  const searchParams = useSearchParams();
  const tabIndex = (TABS as readonly NavItem[]).indexOf(active);

  // Read which tab was active last time so the pill slides FROM there, not from 0.
  const [fromIndex] = useState<number>(() => {
    if (typeof window === "undefined") return tabIndex;
    const stored = sessionStorage.getItem(STORAGE_KEY);
    return stored !== null ? parseInt(stored, 10) : tabIndex;
  });

  // Persist current tab for the next navigation.
  useEffect(() => {
    sessionStorage.setItem(STORAGE_KEY, String(tabIndex));
  }, [tabIndex]);

  const demo = searchParams.get("demo") === "true" ? "?demo=true" : "";
  if (isDesktop) return null;
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-30 bg-bg border-t border-slate-800 max-w-[480px] mx-auto"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="flex relative">
        {/* Sliding pill indicator */}
        <motion.div
          className="absolute top-0 h-[2px] pointer-events-none flex justify-center"
          style={{ width: "33.333%" }}
          initial={{ left: `${fromIndex * 33.333}%` }}
          animate={{ left: `${tabIndex * 33.333}%` }}
          transition={{ type: "spring", stiffness: 420, damping: 36 }}
        >
          <div className="h-full w-5 rounded-full bg-indigo-500" style={{ boxShadow: "0 0 8px #6366f1aa" }} />
        </motion.div>

        <Link
          href={`/${demo}`}
          aria-current={active === "team" ? "page" : undefined}
          className={`flex-1 flex flex-col items-center pt-3 pb-2 gap-0.5 transition-colors duration-150 ${active === "team" ? "text-slate-100" : "text-slate-400"}`}
        >
          <motion.div animate={{ scale: active === "team" ? 1.1 : 1 }} transition={{ type: "spring", stiffness: 400, damping: 25 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="9" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="15" cy="7" r="3" stroke="currentColor" strokeWidth="1.5" />
              <path d="M3 20c0-3.866 2.686-7 6-7h6c3.314 0 6 3.134 6 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </motion.div>
          <span className="text-[10px] font-semibold tracking-wider uppercase">Team</span>
        </Link>

        <Link
          href={`/schedule${demo}`}
          aria-current={active === "schedule" ? "page" : undefined}
          className={`flex-1 flex flex-col items-center pt-3 pb-2 gap-0.5 transition-colors duration-150 ${active === "schedule" ? "text-slate-100" : "text-slate-400"}`}
        >
          <motion.div animate={{ scale: active === "schedule" ? 1.1 : 1 }} transition={{ type: "spring", stiffness: 400, damping: 25 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect x="3" y="5" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.5" />
              <path d="M3 10h18" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 3v4M16 3v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </motion.div>
          <span className="text-[10px] font-semibold tracking-wider uppercase">Schedule</span>
        </Link>

        <Link
          href={`/clock${demo}`}
          aria-current={active === "clock" ? "page" : undefined}
          className={`flex-1 flex flex-col items-center pt-3 pb-2 gap-0.5 transition-colors duration-150 ${active === "clock" ? "text-slate-100" : "text-slate-400"}`}
        >
          <motion.div animate={{ scale: active === "clock" ? 1.1 : 1 }} transition={{ type: "spring", stiffness: 400, damping: 25 }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
              <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.div>
          <span className="text-[10px] font-semibold tracking-wider uppercase">Clock</span>
        </Link>
      </div>
    </nav>
  );
}
