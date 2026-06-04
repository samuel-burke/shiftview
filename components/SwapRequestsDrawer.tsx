"use client";

import { useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useIsDesktop } from "../hooks/useIsDesktop";

const listContainer = { hidden: {}, show: { transition: { staggerChildren: 0.055, delayChildren: 0.12 } } };
const listItem = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 320, damping: 26 } } };

type SwapItem = {
  id: number;
  requesterName: string;
  targetName: string;
  date: string;
  scheduleATime: string;
  scheduleBTime: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  swaps: SwapItem[];
  onApprove: (id: number) => Promise<void>;
  onDeny: (id: number) => Promise<void>;
};

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  } catch {
    return dateStr;
  }
}

export default function SwapRequestsDrawer({
  open,
  onClose,
  swaps,
  onApprove,
  onDeny,
}: Props) {
  const isDesktop = useIsDesktop();

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && open) onClose();
  }, [open, onClose]);

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
            onClick={onClose}
          />
          <motion.div
            key="panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="swap-drawer-title"
            data-testid="swap-requests-drawer"
            className={`fixed z-50 bg-bg ${
              isDesktop
                ? "inset-y-0 right-0 w-[420px] border-l border-slate-800 overflow-y-auto"
                : "bottom-0 left-0 right-0 border-t border-slate-800 rounded-t-3xl max-w-[480px] mx-auto"
            }`}
            initial={isDesktop ? { x: "100%" } : { y: "100%" }}
            animate={isDesktop ? { x: 0 } : { y: 0 }}
            exit={isDesktop ? { x: "100%" } : { y: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 300 }}
          >
            {!isDesktop && (
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-10 h-1 rounded-full bg-slate-700" />
              </div>
            )}

            <div className={isDesktop ? "p-7" : "px-6 pt-2 pb-11"}>
              {/* Header */}
              <div className="flex items-center justify-between mb-5">
                <div>
                  <div id="swap-drawer-title" className="text-lg font-bold text-slate-100">Swap Requests</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {swaps.length} pending
                  </div>
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  autoFocus
                  className="size-10 rounded-full bg-slate-800 border-none text-slate-400 cursor-pointer flex items-center justify-center hover:bg-slate-700 hover:text-slate-200 transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>

              {swaps.length === 0 ? (
                <div className="text-center py-10 text-slate-400 text-sm">
                  No pending swap requests
                </div>
              ) : (
                <motion.div className="flex flex-col gap-3" variants={listContainer} initial="hidden" animate="show">
                  {swaps.map((swap) => (
                    <motion.div key={swap.id} variants={listItem}>
                      <SwapCard
                        swap={swap}
                        onApprove={onApprove}
                        onDeny={onDeny}
                      />
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function SwapCard({
  swap,
  onApprove,
  onDeny,
}: {
  swap: SwapItem;
  onApprove: (id: number) => Promise<void>;
  onDeny: (id: number) => Promise<void>;
}) {
  return (
    <div className="bg-card border border-slate-800/60 rounded-2xl px-4 py-4">
      <div className="text-sm font-semibold text-slate-100 mb-1">
        {swap.requesterName} wants to swap with {swap.targetName}
      </div>
      <div className="text-xs text-slate-400 mb-1">
        {formatDate(swap.date)}
      </div>
      <div className="flex gap-2 text-xs text-slate-400 mb-3">
        <span className="bg-slate-800 rounded-lg px-2 py-1">{swap.requesterName}: {swap.scheduleATime}</span>
        <span className="text-slate-600" aria-hidden="true">⇄</span>
        <span className="bg-slate-800 rounded-lg px-2 py-1">{swap.targetName}: {swap.scheduleBTime}</span>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => onApprove(swap.id)}
          aria-label={`Approve swap between ${swap.requesterName} and ${swap.targetName}`}
          className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 text-white font-bold text-xs cursor-pointer border-none hover:brightness-110 transition-[filter]"
        >
          Approve
        </button>
        <button
          onClick={() => onDeny(swap.id)}
          aria-label={`Deny swap between ${swap.requesterName} and ${swap.targetName}`}
          className="flex-1 py-2.5 rounded-xl bg-transparent border border-slate-700 text-red-400 font-semibold text-xs cursor-pointer hover:bg-red-500/20 hover:border-red-500/40 transition-colors"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
