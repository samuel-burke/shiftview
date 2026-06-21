"use client";

import { motion } from "framer-motion";
import { getMonogram } from "../data/types";

const listContainer = { hidden: {}, show: { transition: { staggerChildren: 0.045 } } };
const listItem = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 320, damping: 26 } } };

// A swap request awaiting *this* user's response. `scheduleA` is the requester's
// shift (what you'd pick up); `scheduleB` is your shift (what you'd give up).
export type IncomingSwap = {
  id: number;
  requesterName: string;
  date: string;
  scheduleATime: string;
  scheduleBTime: string;
};

type Props = {
  swaps: IncomingSwap[];
  respondingId: number | null;
  onAccept: (id: number) => void;
  onDecline: (id: number) => void;
};

function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function SwapRow({ swap, responding, onAccept, onDecline }: {
  swap: IncomingSwap;
  responding: boolean;
  onAccept: (id: number) => void;
  onDecline: (id: number) => void;
}) {
  return (
    <div className="bg-card rounded-2xl border border-slate-800/60 px-4 py-3 mb-2">
      <div className="flex items-center gap-3 mb-2">
        <div className="size-9 rounded-full bg-indigo-600/70 border border-indigo-500/30 flex items-center justify-center text-xs font-bold text-white shrink-0">
          {getMonogram(swap.requesterName)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-slate-100 truncate">
            {swap.requesterName} wants to swap
          </div>
          <div className="text-xs text-slate-400 mt-0.5">{formatDate(swap.date)}</div>
        </div>
      </div>

      <div className="flex items-center gap-2 text-xs text-slate-400 mb-3">
        <span className="bg-slate-800 rounded-lg px-2 py-1">You take: {swap.scheduleATime}</span>
        <span className="text-slate-600" aria-hidden="true">⇄</span>
        <span className="bg-slate-800 rounded-lg px-2 py-1">You give: {swap.scheduleBTime}</span>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onDecline(swap.id)}
          disabled={responding}
          aria-label={`Decline swap with ${swap.requesterName}`}
          aria-busy={responding}
          className="flex-1 py-3 rounded-xl bg-transparent border border-slate-700 text-red-400 font-semibold text-xs cursor-pointer hover:bg-red-500/20 hover:border-red-500/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Decline
        </button>
        <button
          onClick={() => onAccept(swap.id)}
          disabled={responding}
          aria-label={`Accept swap with ${swap.requesterName}`}
          aria-busy={responding}
          className="flex-1 py-3 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 text-white font-bold text-xs cursor-pointer hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed transition-[filter]"
        >
          Accept
        </button>
      </div>
    </div>
  );
}

export default function IncomingSwapRequests({ swaps, respondingId, onAccept, onDecline }: Props) {
  if (swaps.length === 0) return null;

  return (
    <div className="mt-4">
      <div className="flex items-center gap-2 mb-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-1">
        Swap Requests for You
        <span className="bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-px text-[11px] text-amber-400">
          {swaps.length}
        </span>
      </div>
      <p className="text-xs text-slate-500 px-1 mb-2">
        Accepting sends it to a manager for final approval.
      </p>
      <motion.div variants={listContainer} initial="hidden" animate="show">
        {swaps.map((s) => (
          <motion.div key={s.id} variants={listItem}>
            <SwapRow
              swap={s}
              responding={respondingId === s.id}
              onAccept={onAccept}
              onDecline={onDecline}
            />
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
