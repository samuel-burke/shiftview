"use client";

import { useEffect, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useIsDesktop } from "../hooks/useIsDesktop";
import { haptic } from "../lib/haptic";
import { Employee, Schedule, getMonogram, fmtMinutes } from "../data/types";

type ConflictState = {
  type: string;
  window: { startMinutes: number; endMinutes: number } | null;
  message: string;
} | null;

type Props = {
  open: boolean;
  employee: Employee | null;
  draft: Schedule | null; // existing draft shift, or null when adding
  date: string; // YYYY-MM-DD
  onClose: () => void;
  onSave: (employeeId: number, draftId: number | null, startMinutes: number, endMinutes: number, override?: boolean) => Promise<void>;
  onRemove: (draftId: number) => Promise<void>;
};

function minutesToTime(m: number): string {
  if (m < 0) return "";
  return `${Math.floor(m / 60).toString().padStart(2, "0")}:${(m % 60).toString().padStart(2, "0")}`;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export default function DraftShiftSheet({ open, employee, draft, date, onClose, onSave, onRemove }: Props) {
  const isDesktop = useIsDesktop();
  const [startVal, setStartVal] = useState("09:00");
  const [endVal, setEndVal] = useState("17:00");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictState>(null);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (conflict) { setConflict(null); return; }
      if (open) onClose();
    }
  }, [open, conflict, onClose]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (open) {
      setStartVal(draft ? minutesToTime(draft.startMinutes) : "09:00");
      setEndVal(draft ? minutesToTime(draft.endMinutes) : "17:00");
      setError(null);
      setConflict(null);
    }
  }, [open, draft]);

  if (!employee) return null;

  const dateLabel = new Date(date + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "short", day: "numeric",
  });

  async function handleSave(overrideFlag = false) {
    if (!employee) return;
    if (!startVal || !endVal) { setError("Both times are required."); return; }
    const start = timeToMinutes(startVal);
    const end = timeToMinutes(endVal);
    if (start >= end) { setError("End time must be after start time."); return; }
    setSaving(true);
    setError(null);
    setConflict(null);
    try {
      await onSave(employee.id, draft?.id ?? null, start, end, overrideFlag);
      onClose();
    } catch (e) {
      const conflictErr = e instanceof Error && "conflict" in e
        ? (e as Error & { conflict: string; window?: { startMinutes: number; endMinutes: number } | null })
        : null;
      if (conflictErr?.conflict) {
        setConflict({ type: conflictErr.conflict, window: conflictErr.window ?? null, message: conflictErr.message });
      } else {
        setError(e instanceof Error ? e.message : "Failed to save draft shift");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      await onRemove(draft.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove draft shift");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Conflict override modal */}
      <AnimatePresence>
        {conflict && (
          <motion.div
            key="draft-conflict-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[60] flex items-center justify-center px-4"
            style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }}
            onClick={() => setConflict(null)}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="draft-conflict-title"
              initial={{ scale: 0.94, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.96, opacity: 0, y: 4 }}
              transition={{ type: "spring", stiffness: 380, damping: 28 }}
              className="w-full max-w-[360px] bg-card border border-slate-700 rounded-2xl overflow-hidden"
              style={{ boxShadow: "0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-5 pt-5 pb-4 flex flex-col items-center text-center gap-3">
                <div className="size-12 rounded-full bg-amber-500/15 border border-amber-500/25 flex items-center justify-center text-2xl" aria-hidden="true">
                  ⚠️
                </div>
                <div>
                  <div id="draft-conflict-title" className="text-base font-bold text-slate-100">
                    {conflict.type === "time_off" ? "Time Off Conflict" : "Availability Conflict"}
                  </div>
                  <div className="text-sm text-slate-400 mt-1.5">{conflict.message}</div>
                  {conflict.type === "availability" && conflict.window && (
                    <div className="mt-2 text-sm font-semibold text-amber-400">
                      Available: {fmtMinutes(conflict.window.startMinutes)} – {fmtMinutes(conflict.window.endMinutes)}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex border-t border-slate-800">
                <button
                  onClick={() => setConflict(null)}
                  disabled={saving}
                  autoFocus
                  className="flex-1 py-3.5 text-sm font-semibold text-slate-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border-r border-slate-800 bg-transparent border-t-0 border-l-0 border-b-0 hover:bg-slate-800/50 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  onClick={() => { haptic([10, 50, 10]); handleSave(true); }}
                  disabled={saving}
                  aria-busy={saving}
                  className="flex-1 py-3.5 text-sm font-semibold text-amber-400 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-transparent border-none hover:text-amber-300 hover:bg-amber-500/10"
                >
                  {saving ? "Saving…" : "Override & Save"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="draft-sheet-backdrop"
              aria-hidden="true"
              className="fixed inset-0 bg-black/60 z-40"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={onClose}
            />
            <motion.div
              key="draft-sheet-panel"
              role="dialog"
              aria-modal="true"
              aria-labelledby="draft-sheet-title"
              data-testid="draft-shift-sheet"
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
              <div className={isDesktop ? "p-7" : "px-6 pt-5 pb-11"}>
                {/* Header */}
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-3.5">
                    <div className="size-[44px] rounded-[12px] bg-indigo-600/15 border-2 border-indigo-500/30 flex items-center justify-center text-sm font-extrabold text-indigo-300">
                      {getMonogram(employee.name)}
                    </div>
                    <div>
                      <div id="draft-sheet-title" className="text-base font-bold text-slate-100">{employee.name}</div>
                      <div className="text-xs text-slate-400 mt-[3px]">
                        {dateLabel} · <span className="text-amber-400 font-semibold">Draft</span>
                      </div>
                    </div>
                  </div>
                  <motion.button
                    onClick={onClose}
                    aria-label="Close"
                    whileTap={{ scale: 0.88 }}
                    transition={{ type: "spring", stiffness: 450, damping: 25 }}
                    className="size-11 rounded-full bg-slate-800 border-none text-slate-400 text-base cursor-pointer flex items-center justify-center hover:bg-slate-700"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                    </svg>
                  </motion.button>
                </div>

                <div className="flex flex-col gap-3">
                  {[
                    { label: "Start time", id: "draft-shift-start", val: startVal, set: setStartVal, autoFocus: true },
                    { label: "End time",   id: "draft-shift-end",   val: endVal,   set: setEndVal,   autoFocus: false },
                  ].map(({ label, id, val, set, autoFocus }) => (
                    <div key={label}>
                      <label htmlFor={id} className="text-[11px] text-slate-400 uppercase tracking-[0.08em] mb-1.5 block">
                        {label}
                      </label>
                      <input
                        id={id}
                        type="time"
                        value={val}
                        autoFocus={autoFocus}
                        onChange={(e) => { set(e.target.value); setError(null); setConflict(null); }}
                        className="w-full bg-card border border-slate-700 rounded-[10px] px-[14px] py-3 text-slate-100 text-base [color-scheme:dark] focus:outline-none focus:border-indigo-500/70 transition-colors"
                      />
                    </div>
                  ))}

                  {error && (
                    <div role="alert" className="text-xs text-red-400 text-center">{error}</div>
                  )}

                  <motion.button
                    onClick={() => handleSave(false)}
                    disabled={saving}
                    aria-busy={saving}
                    whileTap={!saving ? { scale: 0.97 } : {}}
                    transition={{ type: "spring", stiffness: 400, damping: 22 }}
                    className={`py-[14px] rounded-xl mt-1 bg-gradient-to-r from-blue-500 to-violet-500 border-none text-white font-bold text-sm cursor-pointer disabled:cursor-not-allowed transition-opacity hover:brightness-110 ${saving ? "opacity-70" : "opacity-100"}`}
                  >
                    {saving ? "Saving…" : draft ? "Save Draft Shift" : "Add Draft Shift"}
                  </motion.button>

                  {draft && (
                    <motion.button
                      onClick={handleRemove}
                      disabled={saving}
                      whileTap={!saving ? { scale: 0.97 } : {}}
                      transition={{ type: "spring", stiffness: 400, damping: 22 }}
                      className={`py-[14px] rounded-xl bg-transparent border border-slate-700 text-red-400 font-semibold text-sm cursor-pointer disabled:cursor-not-allowed transition-[opacity,background-color] hover:bg-red-500/10 ${saving ? "opacity-70" : "opacity-100"}`}
                    >
                      Remove from Draft
                    </motion.button>
                  )}

                  <motion.button
                    onClick={onClose}
                    disabled={saving}
                    whileTap={{ scale: 0.97 }}
                    transition={{ type: "spring", stiffness: 400, damping: 22 }}
                    className="py-[14px] rounded-xl bg-transparent border-none text-slate-400 font-semibold text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed hover:text-slate-200 transition-colors"
                  >
                    Cancel
                  </motion.button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
