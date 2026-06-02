"use client";

import { useState } from "react";
import { getMonogram } from "../data/types";
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
    <div className="flex items-center gap-3 bg-gray-900 border border-slate-800 border-l-[3px] border-l-amber-500/50 rounded-xl px-[14px] py-3 mb-2">
      <div className="size-[38px] rounded-full bg-amber-500/10 border-[1.5px] border-amber-500/30 flex items-center justify-center text-xs font-bold text-amber-400 shrink-0">
        {getMonogram(request.employeeName)}
      </div>

      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm text-slate-100 truncate">
          {request.employeeName}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 text-xs text-slate-400">
          <TimeOffPendingIcon size={11} color="currentColor" />
          {formatDate(request.date)}
          {request.note && (
            <span className="text-slate-500 truncate">· "{request.note}"</span>
          )}
        </div>
      </div>

      <div className="flex gap-2 shrink-0">
        <button
          onClick={handleDeny}
          disabled={loading !== null}
          aria-label="Deny"
          className="size-8 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 cursor-pointer hover:bg-red-500/20 disabled:opacity-40 transition-colors"
        >
          {loading === "deny"
            ? <div className="size-3 border border-red-400 border-t-transparent rounded-full animate-spin" />
            : <TimeOffDeniedIcon size={14} color="currentColor" />}
        </button>
        <button
          onClick={handleApprove}
          disabled={loading !== null}
          aria-label="Approve"
          className="size-8 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 cursor-pointer hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
        >
          {loading === "approve"
            ? <div className="size-3 border border-emerald-400 border-t-transparent rounded-full animate-spin" />
            : <TimeOffApprovedIcon size={14} color="currentColor" />}
        </button>
      </div>
    </div>
  );
}

export default function PendingTimeOffSection({ requests, onApprove, onDeny }: Props) {
  if (requests.length === 0) return null;

  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-[10px] text-xs font-bold text-slate-400 uppercase tracking-[0.08em]">
        Pending Time Off
        <span className="bg-amber-500/10 border border-amber-500/30 rounded-full px-2 py-px text-[11px] text-amber-400">
          {requests.length}
        </span>
      </div>
      {requests.map((r) => (
        <RequestRow key={r.id} request={r} onApprove={onApprove} onDeny={onDeny} />
      ))}
    </div>
  );
}
