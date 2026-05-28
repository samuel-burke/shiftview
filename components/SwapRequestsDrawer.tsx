"use client";

import { useIsDesktop } from "../hooks/useIsDesktop";

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
    const d = new Date(dateStr + "T12:00:00Z");
    return d.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
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
        className={`fixed z-50 bg-slate-900 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isDesktop
            ? `inset-y-0 right-0 w-[420px] border-l border-slate-800 overflow-y-auto ${
                open ? "translate-x-0" : "translate-x-full"
              }`
            : `bottom-0 left-0 right-0 border-t border-slate-800 rounded-t-3xl max-w-[480px] mx-auto max-h-[80vh] overflow-y-auto ${
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
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="text-lg font-bold text-slate-100">Swap Requests</div>
              <div className="text-xs text-slate-400 mt-0.5">
                {swaps.length === 0
                  ? "No pending requests"
                  : `${swaps.length} pending`}
              </div>
            </div>
            <button
              onClick={onClose}
              className="size-8 rounded-full bg-slate-800 border-none text-slate-400 text-base cursor-pointer flex items-center justify-center"
            >
              ✕
            </button>
          </div>

          {swaps.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-sm">
              No pending swap requests
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {swaps.map((swap) => (
                <SwapCard
                  key={swap.id}
                  swap={swap}
                  onApprove={onApprove}
                  onDeny={onDeny}
                />
              ))}
            </div>
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
  const dateLabel = formatDate(swap.date);

  async function handleApprove() {
    await onApprove(swap.id);
  }

  async function handleDeny() {
    await onDeny(swap.id);
  }

  return (
    <div className="bg-card border border-slate-800/60 rounded-2xl px-4 py-4">
      <div className="text-sm text-slate-100 font-medium mb-1">
        <span className="text-blue-400">{swap.requesterName}</span>
        {" wants to swap with "}
        <span className="text-violet-400">{swap.targetName}</span>
      </div>
      <div className="text-xs text-slate-400 mb-1">{dateLabel}</div>
      <div className="text-xs text-slate-500 mb-4">
        {swap.scheduleATime} ↔ {swap.scheduleBTime}
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleApprove}
          className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 border-none text-white font-bold text-sm cursor-pointer"
        >
          Approve
        </button>
        <button
          onClick={handleDeny}
          className="flex-1 py-2.5 rounded-xl bg-transparent border border-slate-700 text-red-400 font-semibold text-sm cursor-pointer"
        >
          Deny
        </button>
      </div>
    </div>
  );
}
