"use client";

import { useEffect, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useIsDesktop } from "../hooks/useIsDesktop";
import { getMonogram } from "../data/types";
import {
  TimeOffPendingIcon,
  TimeOffApprovedIcon,
  TimeOffDeniedIcon,
} from "./ShiftIcons";

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

type TimeOffItem = {
  id: number;
  employeeName: string;
  date: string;
  note?: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
  swaps: SwapItem[];
  timeOff: TimeOffItem[];
  onApproveSwap: (id: number) => Promise<void>;
  onDenySwap: (id: number) => Promise<void>;
  onApproveTimeOff: (id: number) => Promise<void>;
  onDenyTimeOff: (id: number) => Promise<void>;
};

function formatLongDate(dateStr: string): string {
  // dateStr is "YYYY-MM-DD"; parse as local date to avoid UTC offset shift
  const [year, month, day] = dateStr.split("-").map(Number);
  if (!year || !month || !day) return dateStr;
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function formatShortDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  if (!year || !month || !day) return dateStr;
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function SectionHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2 mb-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-1">
      {label}
      <span className="bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-px text-[11px] text-amber-400">
        {count}
      </span>
    </div>
  );
}

export default function RequestsDrawer({
  open,
  onClose,
  swaps,
  timeOff,
  onApproveSwap,
  onDenySwap,
  onApproveTimeOff,
  onDenyTimeOff,
}: Props) {
  const isDesktop = useIsDesktop();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (open) setError(null);
  }, [open]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && open) onClose();
  }, [open, onClose]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const total = swaps.length + timeOff.length;

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
            aria-labelledby="requests-drawer-title"
            data-testid="requests-drawer"
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
                <div aria-hidden="true" className="w-10 h-1 rounded-full bg-slate-700" />
              </div>
            )}

            <div className={isDesktop ? "p-7" : "px-6 pt-2 pb-11"}>
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <div id="requests-drawer-title" className="text-lg font-bold text-slate-100">Requests</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {total === 0
                      ? "No pending requests"
                      : `${total} awaiting approval`}
                  </div>
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  autoFocus
                  className="size-11 rounded-full bg-slate-800 border-none text-slate-400 cursor-pointer flex items-center justify-center hover:bg-slate-700 hover:text-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>

              {error && (
                <div role="alert" className="mb-4 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400 text-center">
                  {error}
                </div>
              )}

              {total === 0 ? (
                <div className="text-center py-10 text-slate-400 text-sm">
                  All caught up — no pending requests.
                </div>
              ) : (
                <div className="flex flex-col gap-6">
                  {/* Time Off section */}
                  {timeOff.length > 0 && (
                    <section aria-label="Time off requests">
                      <SectionHeading label="Time Off" count={timeOff.length} />
                      <motion.div className="flex flex-col gap-2" variants={listContainer} initial="hidden" animate="show">
                        {timeOff.map((req) => (
                          <motion.div key={req.id} variants={listItem}>
                            <TimeOffCard request={req} onApprove={onApproveTimeOff} onDeny={onDenyTimeOff} onError={setError} />
                          </motion.div>
                        ))}
                      </motion.div>
                    </section>
                  )}

                  {/* Swap section */}
                  {swaps.length > 0 && (
                    <section aria-label="Swap requests">
                      <SectionHeading label="Shift Swaps" count={swaps.length} />
                      <motion.div className="flex flex-col gap-3" variants={listContainer} initial="hidden" animate="show">
                        {swaps.map((swap) => (
                          <motion.div key={swap.id} variants={listItem}>
                            <SwapCard swap={swap} onApprove={onApproveSwap} onDeny={onDenySwap} onError={setError} />
                          </motion.div>
                        ))}
                      </motion.div>
                    </section>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function TimeOffCard({
  request,
  onApprove,
  onDeny,
  onError,
}: {
  request: TimeOffItem;
  onApprove: (id: number) => Promise<void>;
  onDeny: (id: number) => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const [loading, setLoading] = useState<"approve" | "deny" | null>(null);

  async function run(action: "approve" | "deny", fn: (id: number) => Promise<void>) {
    setLoading(action);
    onError(null);
    try {
      await fn(request.id);
    } catch (e) {
      onError(e instanceof Error ? e.message : `Failed to ${action} request`);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="bg-card rounded-2xl border border-slate-800/60 px-4 py-3">
      <div className="flex items-center gap-3 mb-3">
        <div className="size-9 rounded-full bg-indigo-600/70 border border-indigo-500/30 flex items-center justify-center text-xs font-bold text-white shrink-0">
          {getMonogram(request.employeeName)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-slate-100 truncate">
            {request.employeeName}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 text-xs text-slate-400">
            <TimeOffPendingIcon size={11} color="#fbbf24" />
            {formatShortDate(request.date)}
            {request.note && (
              <span className="text-slate-500 truncate">· &ldquo;{request.note}&rdquo;</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => run("deny", onDeny)}
          disabled={loading !== null}
          aria-label={`Deny ${request.employeeName}'s time off request`}
          aria-busy={loading === "deny"}
          className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold cursor-pointer hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading === "deny"
            ? <div aria-hidden="true" className="size-3 border border-red-400 border-t-transparent rounded-full animate-spin" />
            : <><TimeOffDeniedIcon size={12} color="currentColor" />Deny</>}
        </button>
        <button
          onClick={() => run("approve", onApprove)}
          disabled={loading !== null}
          aria-label={`Approve ${request.employeeName}'s time off request`}
          aria-busy={loading === "approve"}
          className="flex-1 flex items-center justify-center gap-1.5 py-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold cursor-pointer hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading === "approve"
            ? <div aria-hidden="true" className="size-3 border border-emerald-400 border-t-transparent rounded-full animate-spin" />
            : <><TimeOffApprovedIcon size={12} color="currentColor" />Approve</>}
        </button>
      </div>
    </div>
  );
}

function SwapCard({
  swap,
  onApprove,
  onDeny,
  onError,
}: {
  swap: SwapItem;
  onApprove: (id: number) => Promise<void>;
  onDeny: (id: number) => Promise<void>;
  onError: (msg: string | null) => void;
}) {
  const [loading, setLoading] = useState<"approve" | "deny" | null>(null);

  async function run(action: "approve" | "deny", fn: (id: number) => Promise<void>) {
    setLoading(action);
    onError(null);
    try {
      await fn(swap.id);
    } catch (e) {
      onError(e instanceof Error ? e.message : `Failed to ${action} swap`);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="bg-card border border-slate-800/60 rounded-2xl px-4 py-4">
      <div className="text-sm font-semibold text-slate-100 mb-1">
        {swap.requesterName} wants to swap with {swap.targetName}
      </div>
      <div className="text-xs text-slate-400 mb-1">
        {formatLongDate(swap.date)}
      </div>
      <div className="flex gap-2 text-xs text-slate-400 mb-3">
        <span className="bg-slate-800 rounded-lg px-2 py-1">{swap.requesterName}: {swap.scheduleATime}</span>
        <span className="text-slate-600" aria-hidden="true">⇄</span>
        <span className="bg-slate-800 rounded-lg px-2 py-1">{swap.targetName}: {swap.scheduleBTime}</span>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => run("approve", onApprove)}
          disabled={loading !== null}
          aria-busy={loading === "approve"}
          aria-label={`Approve swap between ${swap.requesterName} and ${swap.targetName}`}
          className="flex-1 py-3.5 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 text-white font-bold text-xs cursor-pointer border-none hover:brightness-110 transition-[filter] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading === "approve" ? "…" : "Approve"}
        </button>
        <button
          onClick={() => run("deny", onDeny)}
          disabled={loading !== null}
          aria-busy={loading === "deny"}
          aria-label={`Deny swap between ${swap.requesterName} and ${swap.targetName}`}
          className="flex-1 py-3.5 rounded-xl bg-transparent border border-slate-700 text-red-400 font-semibold text-xs cursor-pointer hover:bg-red-500/20 hover:border-red-500/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading === "deny" ? "…" : "Deny"}
        </button>
      </div>
    </div>
  );
}
