"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAppData } from "@/lib/AppDataContext";

// The "Add to Home Screen" tip for iPhone Safari. It lives in the signed-in
// app (AppShell), never on the marketing pages or in the demo, and stays out
// of the way: at most once a week, and never again once dismissed.
const DISMISSED_KEY = "aths-dismissed";
const SHOWN_AT_KEY = "aths-shown-at";
const SHOW_EVERY_MS = 7 * 24 * 60 * 60 * 1000;
const DELAY_MS = 2000;

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable: it just shows again */ }
}

function ShareIcon({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M12 15V3m0 0L8 7m4-4l4 4"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 11v8a2 2 0 002 2h10a2 2 0 002-2v-8"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function AddToHomeScreenBanner() {
  const { me, sharedLoading } = useAppData();
  const [visible, setVisible] = useState(false);
  const isDemo = me.isDemo;

  useEffect(() => {
    if (sharedLoading || isDemo) return;
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone =
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const dismissed = read(DISMISSED_KEY) === "1";
    const shownAt = Number(read(SHOWN_AT_KEY) ?? 0);
    if (!isIos || isStandalone || dismissed || Date.now() - shownAt < SHOW_EVERY_MS) return;

    const t = setTimeout(() => {
      write(SHOWN_AT_KEY, String(Date.now()));
      setVisible(true);
    }, DELAY_MS);
    return () => clearTimeout(t);
  }, [sharedLoading, isDemo]);

  function dismiss() {
    write(DISMISSED_KEY, "1");
    setVisible(false);
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          role="status"
          aria-label="Add to Home Screen tip"
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 16, opacity: 0 }}
          transition={{ type: "spring", damping: 28, stiffness: 320 }}
          className="fixed left-0 right-0 z-40 px-3 max-w-[480px] mx-auto tablet:hidden"
          style={{ bottom: "calc(72px + env(safe-area-inset-bottom))" }}
        >
          <div
            className="bg-slate-800 border border-slate-700/80 rounded-2xl px-4 py-3.5 flex items-center gap-3"
            style={{
              boxShadow:
                "0 8px 32px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.05)",
            }}
          >
            <div className="shrink-0 size-9 rounded-xl bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center text-indigo-400">
              <ShareIcon />
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-100 leading-tight">
                Add to Home Screen
              </p>
              <p className="text-xs text-slate-400 mt-0.5 leading-snug">
                Tap{" "}
                <ShareIcon
                  size={12}
                  className="inline align-middle mx-0.5 text-slate-300"
                />{" "}
                then{" "}
                <span className="text-slate-300 font-medium">
                  &ldquo;Add to Home Screen&rdquo;
                </span>
              </p>
            </div>

            <button
              onClick={dismiss}
              aria-label="Dismiss"
              className="shrink-0 size-7 flex items-center justify-center rounded-full text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 12 12"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M1 1l10 10M11 1L1 11"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
