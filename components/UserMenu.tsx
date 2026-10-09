"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { getMonogram } from "../data/types";
import { useAppData } from "../lib/AppDataContext";

type Props = {
  name: string | null;
  onSignOut?: () => void;
  onSignIn?: () => void;
};

export default function UserMenu({ name, onSignOut, onSignIn }: Props) {
  const [open, setOpen] = useState(false);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const settingsHref = "/settings";
  const { me, switchOrganization } = useAppData();
  // The switcher only appears for people in more than one organization.
  const organizations = onSignOut && me.organizations.length > 1 ? me.organizations : [];

  async function pickOrganization(orgId: string) {
    if (orgId === me.orgId || switchingTo) return;
    setSwitchingTo(orgId);
    setSwitchError(null);
    const error = await switchOrganization(orgId);
    // On success the app reloads into the new organization.
    if (error) {
      setSwitchError(error);
      setSwitchingTo(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!onSignOut && !onSignIn) return null;

  const monogram = name ? getMonogram(name) : null;

  return (
    <div ref={ref} className="relative">
      <motion.button
        onClick={() => setOpen((o) => !o)}
        aria-label="User menu"
        aria-expanded={open}
        aria-haspopup="menu"
        whileHover={{ scale: 1.08, boxShadow: "0 0 14px rgba(99,102,241,0.3)" }}
        whileTap={{ scale: 0.9 }}
        transition={{ type: "spring", stiffness: 450, damping: 25 }}
        className="size-11 rounded-full bg-indigo-600/80 border border-indigo-500/40 flex items-center justify-center text-sm font-bold text-white cursor-pointer"
      >
        {monogram ?? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
            <path d="M4 20c0-4 3.582-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
      </motion.button>

      <AnimatePresence>
      {open && (
        <motion.div
          role="menu"
          initial={{ opacity: 0, y: -8, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.96 }}
          transition={{ duration: 0.16, ease: [0.25, 0.46, 0.45, 0.94] }}
          className={`absolute right-0 top-11 ${organizations.length ? "w-60" : "w-44"} bg-card border border-slate-700 rounded-xl z-50 overflow-hidden`}
          style={{ boxShadow: "0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)" }}
        >
          {organizations.length > 0 && (
            <div role="group" aria-label="Organization" className="border-b border-slate-700/70 py-1">
              <div className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Organization</div>
              {organizations.map((org) => {
                const current = org.id === me.orgId;
                return (
                  <button
                    key={org.id}
                    role="menuitemradio"
                    aria-checked={current}
                    disabled={switchingTo !== null}
                    onClick={() => pickOrganization(org.id)}
                    className="flex items-center gap-2 w-full px-4 py-2.5 text-left text-sm text-slate-300 hover:bg-slate-700/50 cursor-pointer transition-colors disabled:cursor-default disabled:opacity-60"
                  >
                    <span className="flex-1 min-w-0 truncate" title={org.name}>{org.name}</span>
                    {switchingTo === org.id ? (
                      <span className="text-xs text-slate-500">Switching…</span>
                    ) : current ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="shrink-0 text-indigo-400">
                        <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : null}
                  </button>
                );
              })}
              {switchError && <div role="alert" className="px-4 pb-2 text-xs text-red-400">{switchError}</div>}
            </div>
          )}
          <Link
            href={settingsHref}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 w-full px-4 py-3 text-sm text-slate-300 hover:bg-slate-700/50 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Settings
          </Link>
          <Link
            href="/contact?topic=feedback"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 w-full px-4 py-3 text-sm text-slate-300 hover:bg-slate-700/50 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Send Feedback
          </Link>
          <Link
            href="/privacy"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 w-full px-4 py-3 text-sm text-slate-300 hover:bg-slate-700/50 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Privacy Policy
          </Link>
          {onSignOut && (
            <button
              role="menuitem"
              onClick={() => { setOpen(false); onSignOut(); }}
              className="w-full text-left px-4 py-3 text-sm text-slate-300 hover:bg-slate-700/50 cursor-pointer transition-colors"
            >
              Sign Out
            </button>
          )}
          {onSignIn && (
            <button
              role="menuitem"
              onClick={() => { setOpen(false); onSignIn(); }}
              className="w-full text-left px-4 py-3 text-sm text-blue-400 hover:bg-slate-700/50 cursor-pointer transition-colors"
            >
              Sign In
            </button>
          )}
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}
