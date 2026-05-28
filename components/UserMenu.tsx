"use client";

import { useState, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { getMonogram } from "../data/types";

type Props = {
  name: string | null;
  isManager?: boolean;
  onSignOut?: () => void;
  onSignIn?: () => void;
};

export default function UserMenu({ name, isManager, onSignOut, onSignIn }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const searchParams = useSearchParams();
  const isDemo = searchParams.get("demo") === "true";
  const settingsHref = isDemo ? "/settings?demo=true" : "/settings";

  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open]);

  if (!onSignOut && !onSignIn) return null;

  const monogram = name ? getMonogram(name) : null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="User menu"
        className="size-9 rounded-full bg-indigo-600/80 border border-indigo-500/40 flex items-center justify-center text-sm font-bold text-white cursor-pointer"
      >
        {monogram ?? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
            <path d="M4 20c0-4 3.582-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-40 bg-[#1e2a3a] border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          {isManager && (
            <Link
              href={settingsHref}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 w-full px-4 py-3 text-sm text-slate-300 hover:bg-slate-700/50 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Settings
            </Link>
          )}
          {onSignOut && (
            <button
              onClick={() => { setOpen(false); onSignOut(); }}
              className="w-full text-left px-4 py-3 text-sm text-slate-300 hover:bg-slate-700/50 cursor-pointer transition-colors"
            >
              Sign Out
            </button>
          )}
          {onSignIn && (
            <button
              onClick={() => { setOpen(false); onSignIn(); }}
              className="w-full text-left px-4 py-3 text-sm text-blue-400 hover:bg-slate-700/50 cursor-pointer transition-colors"
            >
              Sign In
            </button>
          )}
        </div>
      )}
    </div>
  );
}
