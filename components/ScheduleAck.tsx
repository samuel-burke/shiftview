"use client";

// UI for schedule acknowledgements. Presentational — data and handlers come from
// the page that talks to /api/schedule-acks.

import type { AckStatus } from "../lib/schedule-ack";

// Employee-facing: confirm you've seen your published schedule for the week.
export function AcknowledgeScheduleButton({
  acknowledged,
  onAcknowledge,
}: {
  acknowledged: boolean;
  onAcknowledge: () => Promise<void> | void;
}) {
  if (acknowledged) {
    return (
      <div
        data-testid="schedule-ack-confirmed"
        className="inline-flex items-center gap-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 px-4 py-2.5 text-sm font-semibold text-emerald-300"
      >
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
          <path d="M3 8l3 3 6-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Schedule confirmed
      </div>
    );
  }
  return (
    <button
      onClick={() => onAcknowledge()}
      data-testid="schedule-ack-button"
      className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 px-4 py-2.5 text-sm font-bold text-white cursor-pointer border-none hover:brightness-110 transition-[filter]"
    >
      Confirm my schedule
    </button>
  );
}

// Manager-facing: who has and hasn't confirmed this week's schedule.
export function ScheduleAckStatus({ status }: { status: AckStatus }) {
  return (
    <div data-testid="schedule-ack-status" className="flex flex-col gap-2">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">
          Schedule Confirmations
        </div>
        <div className={`text-xs font-semibold ${status.allConfirmed ? "text-emerald-400" : "text-amber-400"}`}>
          {status.confirmedCount}/{status.confirmedCount + status.pendingCount} confirmed
        </div>
      </div>

      {status.pendingCount === 0 && status.confirmedCount === 0 ? (
        <div className="text-center py-6 text-slate-400 text-sm">No one scheduled this week</div>
      ) : (
        <>
          {status.pending.length > 0 && (
            <div data-testid="schedule-ack-pending" className="flex flex-col gap-1.5">
              <div className="text-[11px] text-amber-400 font-semibold">Not yet confirmed</div>
              {status.pending.map((e) => (
                <div key={e.employeeId} className="flex items-center rounded-xl px-3 py-2 bg-amber-500/10 border border-amber-500/25">
                  <span className="text-sm font-medium text-slate-100">{e.employeeName}</span>
                </div>
              ))}
            </div>
          )}
          {status.confirmed.length > 0 && (
            <div data-testid="schedule-ack-confirmed-list" className="flex flex-col gap-1.5 mt-1">
              <div className="text-[11px] text-emerald-400 font-semibold">Confirmed</div>
              {status.confirmed.map((e) => (
                <div key={e.employeeId} className="flex items-center rounded-xl px-3 py-2 bg-card border border-slate-800/60">
                  <span className="text-sm font-medium text-slate-300">{e.employeeName}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
