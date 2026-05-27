"use client";

import { useState, useRef, useEffect } from "react";
import { getMonogram } from "../data/types";

type Props = {
  name: string | null;
  onSignOut?: () => void;
  onSignIn?: () => void;
};

export default function UserMenu({ name, onSignOut, onSignIn }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
        <div className="absolute right-0 top-11 w-36 bg-[#1e2a3a] border border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
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
