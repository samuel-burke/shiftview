"use client";

import { useEffect, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useIsDesktop } from "../hooks/useIsDesktop";
import { fmtMinutes } from "../data/types";
import type { ClaimStatus } from "../data/types";

const listContainer = { hidden: {}, show: { transition: { staggerChildren: 0.055, delayChildren: 0.12 } } };
const listItem = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 320, damping: 26 } } };

// Manager-facing claim summary attached to an open shift.
export type OpenShiftClaimView = {
  id: number;
  employeeId: number;
  employeeName: string;
  status: ClaimStatus;
};

export type OpenShiftView = {
  id: number;
  date: string;
  startMinutes: number;
  endMinutes: number;
  note?: string | null;
  status: "open" | "filled" | "cancelled";
  filledByName?: string | null;
  // Manager view: every claim on the shift.
  claims?: OpenShiftClaimView[];
  // Employee view: the caller's own claim status, if any.
  myClaimStatus?: ClaimStatus | null;
};

type ManagerProps = {
  open: boolean;
  onClose: () => void;
  role: "manager";
  openShifts: OpenShiftView[];
  onApproveClaim: (openShiftId: number, claimId: number) => Promise<void> | void;
  onCancel: (openShiftId: number) => Promise<void> | void;
};

type EmployeeProps = {
  open: boolean;
  onClose: () => void;
  role: "employee";
  openShifts: OpenShiftView[];
  onClaim: (openShiftId: number) => Promise<void> | void;
};

type Props = ManagerProps | EmployeeProps;

export function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T12:00:00");
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  } catch {
    return dateStr;
  }
}

export default function OpenShiftsDrawer(props: Props) {
  const { open, onClose, openShifts, role } = props;
  const isDesktop = useIsDesktop();

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape" && open) onClose();
  }, [open, onClose]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const subtitle =
    role === "manager"
      ? `${openShifts.filter((s) => s.status === "open").length} open`
      : `${openShifts.length} available`;

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
            aria-labelledby="open-shifts-drawer-title"
            data-testid="open-shifts-drawer"
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
            {!isDesktop && (
              <div className="flex justify-center pt-3 pb-1">
                <div aria-hidden="true" className="w-10 h-1 rounded-full bg-slate-700" />
              </div>
            )}

            <div className={isDesktop ? "p-7" : "px-6 pt-2 pb-11"}>
              <div className="flex items-center justify-between mb-5">
                <div>
                  <div id="open-shifts-drawer-title" className="text-lg font-bold text-slate-100">Open Shifts</div>
                  <div className="text-xs text-slate-400 mt-0.5">{subtitle}</div>
                </div>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  autoFocus
                  className="size-11 rounded-full bg-slate-800 border-none text-slate-400 cursor-pointer flex items-center justify-center hover:bg-slate-700 hover:text-slate-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
                  </svg>
                </button>
              </div>

              {openShifts.length === 0 ? (
                <div className="text-center py-10 text-slate-400 text-sm">
                  {role === "manager" ? "No open shifts posted" : "No open shifts to pick up"}
                </div>
              ) : (
                <motion.div className="flex flex-col gap-3" variants={listContainer} initial="hidden" animate="show">
                  {openShifts.map((shift) => (
                    <motion.div key={shift.id} variants={listItem}>
                      {props.role === "manager" ? (
                        <ManagerCard shift={shift} onApproveClaim={props.onApproveClaim} onCancel={props.onCancel} />
                      ) : (
                        <EmployeeCard shift={shift} onClaim={props.onClaim} />
                      )}
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

function TimeRange({ shift }: { shift: OpenShiftView }) {
  return (
    <div className="text-xs text-slate-400 mb-2">
      <span className="bg-slate-800 rounded-lg px-2 py-1">
        {fmtMinutes(shift.startMinutes)} – {fmtMinutes(shift.endMinutes)}
      </span>
    </div>
  );
}

function ManagerCard({
  shift,
  onApproveClaim,
  onCancel,
}: {
  shift: OpenShiftView;
  onApproveClaim: (openShiftId: number, claimId: number) => Promise<void> | void;
  onCancel: (openShiftId: number) => Promise<void> | void;
}) {
  const pendingClaims = (shift.claims ?? []).filter((c) => c.status === "pending");
  const filled = shift.status === "filled";

  return (
    <div className="bg-card border border-slate-800/60 rounded-2xl px-4 py-4">
      <div className="flex items-center justify-between mb-1">
        <div className="text-sm font-semibold text-slate-100">{formatDate(shift.date)}</div>
        {filled && (
          <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-400 bg-emerald-500/15 rounded-full px-2 py-0.5">
            Filled
          </span>
        )}
      </div>
      <TimeRange shift={shift} />
      {shift.note && <div className="text-xs text-slate-400 mb-2">{shift.note}</div>}

      {filled ? (
        <div className="text-xs text-slate-300">Picked up by {shift.filledByName ?? "an employee"}</div>
      ) : pendingClaims.length === 0 ? (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-slate-500">No claims yet</span>
          <button
            onClick={() => onCancel(shift.id)}
            aria-label={`Cancel open shift on ${formatDate(shift.date)}`}
            className="py-2 px-3 rounded-xl bg-transparent border border-slate-700 text-red-400 font-semibold text-xs cursor-pointer hover:bg-red-500/20 hover:border-red-500/40 transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {pendingClaims.map((claim) => (
            <div key={claim.id} className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-200 font-medium">{claim.employeeName}</span>
              <button
                onClick={() => onApproveClaim(shift.id, claim.id)}
                aria-label={`Assign ${claim.employeeName} to the shift on ${formatDate(shift.date)}`}
                className="py-2 px-3 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 text-white font-bold text-xs cursor-pointer border-none hover:brightness-110 transition-[filter]"
              >
                Assign
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmployeeCard({
  shift,
  onClaim,
}: {
  shift: OpenShiftView;
  onClaim: (openShiftId: number) => Promise<void> | void;
}) {
  const claimed = shift.myClaimStatus === "pending";

  return (
    <div className="bg-card border border-slate-800/60 rounded-2xl px-4 py-4">
      <div className="text-sm font-semibold text-slate-100 mb-1">{formatDate(shift.date)}</div>
      <TimeRange shift={shift} />
      {shift.note && <div className="text-xs text-slate-400 mb-2">{shift.note}</div>}

      {claimed ? (
        <div className="text-xs text-amber-300 font-semibold">Claim pending approval</div>
      ) : (
        <button
          onClick={() => onClaim(shift.id)}
          aria-label={`Claim the shift on ${formatDate(shift.date)}`}
          className="w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 text-white font-bold text-xs cursor-pointer border-none hover:brightness-110 transition-[filter]"
        >
          Claim shift
        </button>
      )}
    </div>
  );
}
