"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { getMonogram } from "../data/types";

const listContainer = { hidden: {}, show: { transition: { staggerChildren: 0.045 } } };
const listItem = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 320, damping: 26 } } };
import {
  TimeOffPendingIcon,
  TimeOffApprovedIcon,
  TimeOffDeniedIcon,
} from "./ShiftIcons";

type Request = {
  id: number;
  employeeName: string;
  date: string;
  note?: string;
};

type Props = {
  requests: Request[];
  onApprove: (id: number) => Promise<void>;
  onDeny: (id: number) => Promise<void>;
};

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function RequestRow({
  request,
  onApprove,
  onDeny,
}: {
  request: Request;
  onApprove: (id: number) => Promise<void>;
  onDeny: (id: number) => Promise<void>;
}) {
  const [loading, setLoading] = useState<"approve" | "deny" | null>(null);

  async function handleApprove() {
    setLoading("approve");
    try { await onApprove(request.id); } finally { setLoading(null); }
  }

  async function handleDeny() {
    setLoading("deny");
    try { await onDeny(request.id); } finally { setLoading(null); }
  }

  return (
    <div className="bg-card rounded-2xl border border-slate-800/60 px-4 py-3 mb-2">
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
            {formatDate(request.date)}
            {request.note && (
              <span className="text-slate-500 truncate">· "{request.note}"</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleDeny}
          disabled={loading !== null}
          aria-label={`Deny ${request.employeeName}'s time off request`}
          aria-busy={loading === "deny"}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold cursor-pointer hover:bg-red-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading === "deny"
            ? <div aria-hidden="true" className="size-3 border border-red-400 border-t-transparent rounded-full animate-spin" />
            : <><TimeOffDeniedIcon size={12} color="currentColor" />Deny</>}
        </button>
        <button
          onClick={handleApprove}
          disabled={loading !== null}
          aria-label={`Approve ${request.employeeName}'s time off request`}
          aria-busy={loading === "approve"}
          className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold cursor-pointer hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loading === "approve"
            ? <div aria-hidden="true" className="size-3 border border-emerald-400 border-t-transparent rounded-full animate-spin" />
            : <><TimeOffApprovedIcon size={12} color="currentColor" />Approve</>}
        </button>
      </div>
    </div>
  );
}

export default function PendingTimeOffSection({ requests, onApprove, onDeny }: Props) {
  if (requests.length === 0) return null;

  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-1">
        Pending Time Off
        <span className="bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-px text-[11px] text-amber-400">
          {requests.length}
        </span>
      </div>
      <motion.div variants={listContainer} initial="hidden" animate="show">
        {requests.map((r) => (
          <motion.div key={r.id} variants={listItem}>
            <RequestRow request={r} onApprove={onApprove} onDeny={onDeny} />
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
