"use client";

import { motion } from "framer-motion";
import type { WeekMode } from "@/lib/week-params";

// The Week page's header: the week and its navigation, the Live | Draft
// toggle, and (Draft only) Auto-schedule and Publish.

type Props = {
  mode: WeekMode;
  weekLabel: string;
  isThisWeek: boolean;
  /** Drafts saved for the week, shown on the Draft toggle from either mode. */
  draftCount: number;
  /** Drafts that will go live: the ones whose person has no live shift that day. */
  publishCount: number;
  /**
   * The store's settings have loaded. Until then the week's start day isn't
   * known, so the week isn't shown and can't be changed.
   */
  ready: boolean;
  /** Shifts are still loading: Auto-schedule and Publish wait. */
  busy: boolean;
  onModeChange: (mode: WeekMode) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  onThisWeek: () => void;
  onAutoSchedule: () => void;
  onPublish: () => void;
  onBack: () => void;
};

const HINT: Record<WeekMode, string> = {
  live: "Changes go to the team right away.",
  draft: "Private until you publish. Live shifts stay as they are.",
};

const navButton =
  "size-10 shrink-0 rounded-xl bg-card border border-slate-800 text-slate-400 flex items-center justify-center cursor-pointer hover:bg-slate-800 hover:text-slate-200 transition-colors disabled:opacity-40 disabled:cursor-default";

export function Sparkle() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9L12 3z" fill="currentColor" />
      <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

function ModeToggle({
  mode,
  draftCount,
  disabled,
  onChange,
}: {
  mode: WeekMode;
  draftCount: number;
  disabled: boolean;
  onChange: (m: WeekMode) => void;
}) {
  const options: { value: WeekMode; label: string; dot: string }[] = [
    { value: "live", label: "Live", dot: "bg-emerald-400" },
    { value: "draft", label: "Draft", dot: "bg-amber-400" },
  ];
  return (
    <div role="radiogroup" aria-label="Schedule" className="flex shrink-0 bg-card border border-slate-800 rounded-xl p-[3px] gap-[3px]">
      {options.map((o) => {
        const active = o.value === mode;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={o.value === "draft" && draftCount > 0 ? `Draft, ${draftCount} ${draftCount === 1 ? "shift" : "shifts"}` : undefined}
            disabled={disabled}
            onClick={() => { if (!active) onChange(o.value); }}
            className={`min-h-10 px-3 rounded-[9px] text-sm font-semibold cursor-pointer transition-colors flex items-center gap-1.5 disabled:cursor-default ${
              active ? "bg-slate-800 text-slate-50 shadow" : "bg-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            <span aria-hidden="true" className={`size-1.5 rounded-full ${active ? o.dot : "bg-slate-600"}`} />
            {o.label}
            {o.value === "draft" && draftCount > 0 && (
              <span className="min-w-5 h-5 px-1.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-[11px] font-bold text-amber-400 tabular-nums flex items-center justify-center">
                {draftCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function WeekNav({ ready, isThisWeek, onPrevWeek, onNextWeek, onThisWeek }: Pick<Props, "ready" | "isThisWeek" | "onPrevWeek" | "onNextWeek" | "onThisWeek">) {
  return (
    <div className="flex items-center gap-1.5 tablet:gap-2">
      <button type="button" onClick={onPrevWeek} disabled={!ready} aria-label="Previous week" className={navButton}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <button
        type="button"
        onClick={onThisWeek}
        disabled={isThisWeek || !ready}
        className="h-10 px-2.5 tablet:px-3.5 rounded-xl bg-card border border-slate-800 text-xs tablet:text-sm font-semibold text-slate-200 cursor-pointer hover:bg-slate-800 transition-colors disabled:opacity-40 disabled:cursor-default whitespace-nowrap"
      >
        This week
      </button>
      <button type="button" onClick={onNextWeek} disabled={!ready} aria-label="Next week" className={navButton}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
  );
}

export default function WeekHeader(props: Props) {
  const { mode, weekLabel, ready, draftCount, publishCount, busy, onModeChange, onAutoSchedule, onPublish, onBack } = props;
  const isDraft = mode === "draft";

  return (
    <div
      className="px-4 pb-3 border-b border-slate-800 bg-bg tablet:px-6 desk:pb-[14px]"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 14px)" }}
    >
      {/* The week. Tablets and up keep its navigation on this row. */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={onBack} aria-label="Back" className={`${navButton} size-11 tablet:hidden`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-slate-400 font-semibold tracking-wider uppercase">Week</div>
          <h1 className="text-lg tablet:text-xl font-extrabold text-slate-100 tracking-tight tabular-nums" aria-busy={!ready}>
            {ready ? weekLabel : <span className="skeleton inline-block align-middle h-5 w-44 rounded-md" />}
          </h1>
        </div>
        <div className="hidden tablet:block">
          <WeekNav {...props} />
        </div>
      </div>

      {/* Live | Draft, what it means, and Draft's actions. Phones: the week's
          navigation sits beside the toggle and the actions get a row. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-2.5 tablet:gap-x-3">
        <ModeToggle mode={mode} draftCount={draftCount} disabled={!ready} onChange={onModeChange} />
        <div className="ml-auto tablet:hidden">
          <WeekNav {...props} />
        </div>
        <p className="w-full tablet:w-auto tablet:flex-1 tablet:min-w-0 text-xs text-slate-400" data-testid="week-mode-hint">
          {HINT[mode]}
        </p>
        {isDraft && (
          <div className="w-full tablet:w-auto flex items-center gap-2">
            <motion.button
              type="button"
              onClick={onAutoSchedule}
              disabled={busy}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              data-testid="auto-schedule-button"
              className="flex-1 tablet:flex-none min-h-11 tablet:min-h-10 px-3.5 rounded-xl bg-violet-500/15 border border-violet-500/35 text-violet-200 font-bold text-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:bg-violet-500/25 transition-colors flex items-center justify-center gap-1.5"
            >
              <Sparkle />
              Auto-schedule
            </motion.button>
            <motion.button
              type="button"
              onClick={onPublish}
              disabled={busy || publishCount === 0}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              className="flex-1 tablet:flex-none min-h-11 tablet:min-h-10 px-4 rounded-xl bg-gradient-to-r from-blue-500 to-violet-500 border-none text-white font-bold text-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition-all"
            >
              Publish ({publishCount})
            </motion.button>
          </div>
        )}
      </div>
    </div>
  );
}
