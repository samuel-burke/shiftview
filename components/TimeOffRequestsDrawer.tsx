"use client";

import { useEffect, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useIsDesktop } from "../hooks/useIsDesktop";

const listContainer = { hidden: {}, show: { transition: { staggerChildren: 0.055, delayChildren: 0.12 } } };
const listItem = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 320, damping: 26 } } };

type TimeOffRequest = {
  id: number;
  employeeName: string;
  date: string;
  note?: string;
  status: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  requests: TimeOffRequest[];
  onApprove: (id: number) => Promise<void>;
  onDeny: (id: number) => Promise<void>;
};

function formatDate(dateStr: string): string {
  // dateStr is "YYYY-MM-DD"; parse as local date to avoid UTC offset shift
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

export default function TimeOffRequestsDrawer({
  open,
  onClose,
  requests,
  onApprove,
  onDeny,
}: Props) {
  const isDesktop = useIsDesktop();
  const [acting, setActing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setActing(null);
      setError(null);
    }
  }, [open]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && open) onClose();
  }, [open, onClose]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  async function handleApprove(id: number) {
    setActing(id);
    setError(null);
    try {
      await onApprove(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve request");
    } finally {
      setActing(null);
    }
  }

  async function handleDeny(id: number) {
    setActing(id);
    setError(null);
    try {
      await onDeny(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to deny request");
    } finally {
      setActing(null);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
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
            aria-labelledby="timeoff-drawer-title"
            data-testid="time-off-drawer"
            className={`fixed z-50 bg-bg ${
              isDesktop
                ? "inset-y-0 right-0 w-[420px] border-l border-slate-800 overflow-y-auto"
                : "bottom-0 left-0 right-0 border-t border-slate-800 rounded-t-3xl max-w-[480px] mx-auto max-h-[80vh] overflow-y-auto"
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
              <div className="flex items-center justify-between mb-6">
                <div>
                  <div id="timeoff-drawer-title" className="text-lg font-bold text-slate-100">Time Off Requests</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {requests.length === 0
                      ? "No pending requests"
                      : `${requests.length} pending request${requests.length !== 1 ? "s" : ""}`}
                  </div>
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="size-10 rounded-full bg-slate-800 border-none text-slate-400 text-base cursor-pointer flex items-center justify-center"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>

              {error && (
                <div className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 text-center">
                  {error}
                </div>
              )}

              {requests.length === 0 ? (
                <div className="text-center py-10 text-slate-400 text-sm">
                  All caught up — no pending time off requests.
                </div>
              ) : (
                <motion.div className="flex flex-col gap-3" variants={listContainer} initial="hidden" animate="show">
                  {requests.map((req) => (
                    <motion.div
                      key={req.id}
                      variants={listItem}
                      className="bg-card rounded-2xl border border-slate-800/60 px-4 py-4"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="font-semibold text-slate-100 text-sm">{req.employeeName}</div>
                      </div>
                      <div className="text-xs text-slate-400 mb-2">{formatDate(req.date)}</div>
                      {req.note && (
                        <div className="text-xs text-slate-300 bg-slate-800/60 rounded-lg px-3 py-2 mb-3 italic">
                          &ldquo;{req.note}&rdquo;
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApprove(req.id)}
                          disabled={acting === req.id}
                          className={`flex-1 py-2.5 rounded-xl text-sm font-bold border-none cursor-pointer transition-opacity bg-gradient-to-r from-blue-500 to-violet-500 text-white ${
                            acting === req.id ? "opacity-50" : ""
                          }`}
                        >
                          {acting === req.id ? "…" : "Approve"}
                        </button>
                        <button
                          onClick={() => handleDeny(req.id)}
                          disabled={acting === req.id}
                          className={`flex-1 py-2.5 rounded-xl text-sm font-bold border border-red-500/30 cursor-pointer transition-opacity bg-transparent text-red-400 ${
                            acting === req.id ? "opacity-50" : "hover:bg-red-500/10"
                          }`}
                        >
                          {acting === req.id ? "…" : "Deny"}
                        </button>
                      </div>
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
