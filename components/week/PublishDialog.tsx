"use client";

import { AnimatePresence, motion } from "framer-motion";

// Confirms publishing the week's drafts. Drafts whose person already has a
// live shift that day don't publish; they stay in Draft.

type Props = {
  open: boolean;
  publishing: boolean;
  weekLabel: string;
  /** Drafts that will go live. */
  publishCount: number;
  /** Drafts that won't: their person already has a live shift that day. */
  clashCount: number;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function PublishDialog({ open, publishing, weekLabel, publishCount, clashCount, onCancel, onConfirm }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="publish-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[60] flex items-center justify-center px-4"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
          onClick={() => !publishing && onCancel()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="publish-modal-title"
            initial={{ scale: 0.94, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 4 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            className="w-full max-w-[360px] bg-card border border-slate-700 rounded-2xl overflow-hidden"
            style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-4 flex flex-col items-center text-center gap-3">
              <div className="size-12 rounded-full bg-blue-500/15 border border-blue-500/25 flex items-center justify-center text-2xl" aria-hidden="true">
                📣
              </div>
              <div>
                <div id="publish-modal-title" className="text-base font-bold text-slate-100">Publish Week?</div>
                <div className="text-sm text-slate-400 mt-1.5">
                  {publishCount} draft shift{publishCount === 1 ? "" : "s"} for {weekLabel} will go live and employees will be notified.
                </div>
                {clashCount > 0 && (
                  <div className="text-xs text-amber-400 mt-2">
                    {clashCount === 1
                      ? "1 draft won't publish: that person already has a live shift that day. It stays in Draft."
                      : `${clashCount} drafts won't publish: those people already have a live shift that day. They stay in Draft.`}
                  </div>
                )}
              </div>
            </div>
            <div className="flex border-t border-slate-800">
              <button
                type="button"
                onClick={onCancel}
                disabled={publishing}
                autoFocus
                className="flex-1 py-3.5 text-sm font-semibold text-slate-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border-r border-slate-800 bg-transparent border-t-0 border-l-0 border-b-0 hover:bg-slate-800/50 hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={publishing}
                aria-busy={publishing}
                className="flex-1 py-3.5 text-sm font-bold text-blue-400 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-transparent border-none hover:text-blue-300 hover:bg-blue-500/10"
              >
                {publishing ? "Publishing…" : "Publish"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
