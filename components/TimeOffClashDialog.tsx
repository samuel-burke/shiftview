"use client";

import { AnimatePresence, motion } from "framer-motion";
import { fmtMinutes } from "@/data/types";
import { formatDateKey } from "@/lib/dates";
import type { ClashingShift } from "@/lib/time-off-client";

// Asks what to do with the shifts a time-off request overlaps before
// approving it: take them off the schedule (the employee is told), or keep
// them and approve anyway.

type Props = {
  open: boolean;
  employeeName: string;
  shifts: ClashingShift[];
  busy: boolean;
  onRemove: () => void;
  onKeep: () => void;
  onCancel: () => void;
};

export default function TimeOffClashDialog({ open, employeeName, shifts, busy, onRemove, onKeep, onCancel }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="time-off-clash-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[60] flex items-center justify-center px-4"
          style={{ background: "color-mix(in oklab, var(--color-scrim) 75%, transparent)", backdropFilter: "blur(4px)" }}
          onClick={() => !busy && onCancel()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="time-off-clash-title"
            data-testid="time-off-clash-dialog"
            initial={{ scale: 0.94, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.96, opacity: 0, y: 4 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            className="w-full max-w-[380px] bg-card border border-line-strong rounded-2xl overflow-hidden"
            style={{ boxShadow: "var(--shadow-dialog)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-4 text-center">
              <div id="time-off-clash-title" className="text-base font-bold text-fg">
                {employeeName} is scheduled then
              </div>
              <div className="text-sm text-fg-muted mt-1.5">
                Approving this time off leaves {shifts.length === 1 ? "this shift" : "these shifts"} on the schedule unless you remove {shifts.length === 1 ? "it" : "them"}.
              </div>
              <ul className="mt-3 text-sm text-fg space-y-1">
                {shifts.map((s) => (
                  <li key={s.id} className="tabular-nums">
                    {formatDateKey(s.date, { weekday: "short", month: "short", day: "numeric" })} · {fmtMinutes(s.startMinutes)} – {fmtMinutes(s.endMinutes)}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex flex-col border-t border-line">
              <button
                type="button"
                onClick={onRemove}
                disabled={busy}
                autoFocus
                className="py-3.5 text-sm font-bold text-info-fg transition-colors cursor-pointer disabled:opacity-50 bg-transparent border-none hover:bg-info/10"
              >
                {busy ? "Saving…" : `Approve and remove ${shifts.length === 1 ? "the shift" : `${shifts.length} shifts`}`}
              </button>
              <button
                type="button"
                onClick={onKeep}
                disabled={busy}
                className="py-3.5 text-sm font-semibold text-fg-secondary border-t border-line transition-colors cursor-pointer disabled:opacity-50 bg-transparent border-x-0 border-b-0 hover:bg-fill/50"
              >
                Approve and keep {shifts.length === 1 ? "it" : "them"}
              </button>
              <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                className="py-3.5 text-sm font-semibold text-fg-muted border-t border-line transition-colors cursor-pointer disabled:opacity-50 bg-transparent border-x-0 border-b-0 hover:bg-fill/50"
              >
                Cancel
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
