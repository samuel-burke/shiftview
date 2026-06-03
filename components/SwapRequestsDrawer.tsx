"use client";

import { motion } from "framer-motion";
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

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 bg-black/60 z-40 transition-opacity duration-[250ms] ${
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      />

      {/* Drawer */}
      <div
        data-testid="swap-requests-drawer"
        className={`fixed z-50 bg-bg transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isDesktop
            ? `inset-y-0 right-0 w-[420px] border-l border-slate-800 overflow-y-auto ${
                open ? "translate-x-0" : "translate-x-full"
              }`
            : `bottom-0 left-0 right-0 border-t border-slate-800 rounded-t-3xl max-w-[480px] mx-auto ${
                open ? "translate-y-0" : "translate-y-full"
              }`
        }`}
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
              <div className="text-lg font-bold text-slate-100">Swap Requests</div>
              <div className="text-xs text-slate-400 mt-0.5">
                {swaps.length} pending
              </div>
            </div>
            <button
              onClick={onClose}
              className="size-10 rounded-full bg-slate-800 border-none text-slate-400 text-base cursor-pointer flex items-center justify-center"
            >
              ✕
            </button>
          </div>

          {swaps.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-sm">
              No pending swap requests
            </div>
          ) : (
            <motion.div className="flex flex-col gap-3" variants={listContainer} initial="hidden" animate={open ? "show" : "hidden"}>
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
      </div>
    </>
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
        <span className="text-slate-600">⇄</span>
        <span className="bg-slate-800 rounded-lg px-2 py-1">{swap.targetName}: {swap.scheduleBTime}</span>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => onApprove(swap.id)}
          className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 text-white font-bold text-xs cursor-pointer border-none"
        >
          Approve
        </button>
        <button
          onClick={() => onDeny(swap.id)}
          className="flex-1 py-2.5 rounded-xl bg-transparent border border-slate-700 text-red-400 font-semibold text-xs cursor-pointer"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
