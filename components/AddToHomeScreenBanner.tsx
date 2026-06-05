"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";

const DISMISSED_KEY = "aths-dismissed";

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
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone =
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const dismissed = localStorage.getItem(DISMISSED_KEY) === "1";

    if (isIos && !isStandalone && !dismissed) {
      const t = setTimeout(() => setVisible(true), 1000);
      return () => clearTimeout(t);
    }
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
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
          className="fixed left-0 right-0 z-40 px-3 max-w-[480px] mx-auto [@media(min-width:900px)]:hidden"
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
