"use client";

import { useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useIsDesktop } from "../hooks/useIsDesktop";
import { fmtMinutes, getMonogram } from "../data/types";

const listContainer = { hidden: {}, show: { transition: { staggerChildren: 0.045, delayChildren: 0.08 } } };
const listItem = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 320, damping: 26 } } };

// A coworker's shift on the same day that the user could swap into.
export type CoworkerShift = {
  scheduleId: number;
  employeeName: string;
  startMinutes: number;
  endMinutes: number;
};

type Props = {
  open: boolean;
  onClose: () => void;
  dateLabel: string;
  myShiftTime: string;
  coworkers: CoworkerShift[];
  loading: boolean;
  error: string | null;
  submitting: boolean;
  submitError: string | null;
  onSelect: (scheduleId: number) => void;
};

export default function SwapRequestSheet({
  open,
  onClose,
  dateLabel,
  myShiftTime,
  coworkers,
  loading,
  error,
  submitting,
  submitError,
  onSelect,
}: Props) {
  const isDesktop = useIsDesktop();

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && open && !submitting) onClose();
  }, [open, submitting, onClose]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            aria-hidden="true"
            className="fixed inset-0 bg-black/60 z-40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => { if (!submitting) onClose(); }}
          />
          <motion.div
            key="panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="swap-request-title"
            data-testid="swap-request-sheet"
            className={`fixed z-50 bg-bg ${
              isDesktop
                ? "top-1/2 left-1/2 w-[420px] -translate-x-1/2 -translate-y-1/2 border border-slate-800 rounded-[20px] max-h-[80vh] overflow-y-auto"
                : "bottom-0 left-0 right-0 border-t border-slate-800 rounded-t-3xl max-w-[480px] mx-auto max-h-[85vh] overflow-y-auto"
            }`}
            initial={isDesktop ? { opacity: 0, scale: 0.96 } : { y: "100%" }}
            animate={isDesktop ? { opacity: 1, scale: 1 } : { y: 0 }}
            exit={isDesktop ? { opacity: 0, scale: 0.96 } : { y: "100%" }}
            transition={isDesktop ? { type: "spring", damping: 28, stiffness: 320 } : { type: "spring", damping: 32, stiffness: 300 }}
          >
            {!isDesktop && (
              <div className="flex justify-center pt-3 pb-1">
                <div aria-hidden="true" className="w-10 h-1 rounded-full bg-slate-700" />
              </div>
            )}

            <div className={isDesktop ? "p-7" : "px-6 pt-2 pb-11"}>
              {/* Header */}
              <div className="flex items-start justify-between mb-1">
                <div>
                  <div id="swap-request-title" className="text-lg font-bold text-slate-100">Request a Swap</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {dateLabel} · your shift {myShiftTime}
                  </div>
                </div>
                <button
                  onClick={onClose}
                  disabled={submitting}
                  aria-label="Close"
                  className="size-11 rounded-full bg-slate-800 border-none text-slate-400 cursor-pointer flex items-center justify-center hover:bg-slate-700 hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 shrink-0"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>

              <div className="text-[11px] text-slate-400 font-semibold uppercase tracking-wider mt-5 mb-2">
                Pick a coworker to swap with
              </div>

              {loading ? (
                <div className="flex flex-col gap-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-[58px] rounded-2xl bg-slate-800/50 animate-pulse" />
                  ))}
                </div>
              ) : error ? (
                <div role="alert" className="text-center py-8 text-sm text-red-400">{error}</div>
              ) : coworkers.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-sm">
                  No coworkers are scheduled on this day to swap with.
                </div>
              ) : (
                <motion.div className="flex flex-col gap-2" variants={listContainer} initial="hidden" animate="show">
                  {coworkers.map((c) => (
                    <motion.button
                      key={c.scheduleId}
                      variants={listItem}
                      onClick={() => onSelect(c.scheduleId)}
                      disabled={submitting}
                      aria-label={`Request swap with ${c.employeeName}, ${fmtMinutes(c.startMinutes)} to ${fmtMinutes(c.endMinutes)}`}
                      className="flex items-center gap-3 w-full text-left bg-card border border-slate-800/60 rounded-2xl px-4 py-3 cursor-pointer hover:border-indigo-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      <div className="size-9 rounded-full bg-indigo-600/70 border border-indigo-500/30 flex items-center justify-center text-xs font-bold text-white shrink-0">
                        {getMonogram(c.employeeName)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm text-slate-100 truncate">{c.employeeName}</div>
                        <div className="text-xs text-slate-400 mt-0.5">
                          {fmtMinutes(c.startMinutes)} – {fmtMinutes(c.endMinutes)}
                        </div>
                      </div>
                      <span className="text-slate-600 text-base shrink-0" aria-hidden="true">⇄</span>
                    </motion.button>
                  ))}
                </motion.div>
              )}

              {submitting && (
                <div role="status" aria-live="polite" className="mt-4 text-center text-sm text-slate-400">
                  Sending request…
                </div>
              )}
              {submitError && !submitting && (
                <div role="alert" className="mt-4 text-center text-sm text-red-400">{submitError}</div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
