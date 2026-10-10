"use client";

/**
 * A placeholder bar exactly as wide and tall as `text` set in the
 * surrounding font. The words are CSS-generated content (from data-text),
 * so they aren't part of the page's text: find-in-page, screen readers and
 * text lookups don't see a placeholder name or label.
 */
export function SkeletonText({ text, className = "" }: { text: string; className?: string }) {
  return <span aria-hidden="true" data-text={text} className={`skeleton rounded text-transparent before:content-[attr(data-text)] ${className}`} />;
}

export function SkeletonShiftCard() {
  return (
    <div aria-hidden="true" className="flex items-center gap-3 w-full bg-card border border-slate-800 border-l-[3px] border-l-slate-800 rounded-xl px-[14px] py-3 mb-2">
      <div className="skeleton size-[38px] rounded-full shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="skeleton h-[13px] w-[55%] rounded" />
        <div className="skeleton h-[10px] w-[28%] rounded mt-[7px]" />
      </div>
      {/* ShiftCard's right side: the times (a 16px line), then the badge row. */}
      <div className="shrink-0 flex flex-col items-end">
        <div className="h-4 flex items-center"><div className="skeleton h-[10px] w-20 rounded" /></div>
        <div className="mt-[5px] h-6" />
      </div>
    </div>
  );
}

export function SkeletonTeamSection({ count = 4 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading schedule" className="mb-5">
      {/* TeamSection's header: an xs line and its count pill, same boxes. */}
      <div aria-hidden="true" className="flex items-center gap-2 mb-[10px] text-xs">
        <div className="skeleton h-3 w-20 rounded" />
        <span className="skeleton rounded-full border border-transparent px-2 py-px text-[11px]"><span className="invisible">00</span></span>
      </div>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonShiftCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonNextShift() {
  // The next-shift card's two lines: the date (a 20px line) and the time (32px).
  return (
    <div role="status" aria-label="Loading next shift">
      <div className="h-5 flex items-center"><div className="skeleton h-[14px] w-24 rounded" /></div>
      <div className="h-8 mt-1 flex items-center"><div className="skeleton h-7 w-44 rounded" /></div>
    </div>
  );
}

export function SkeletonWeekCalendar() {
  // WeekView's day cells line for line: the same boxes, with placeholder text
  // set in each line's own font so every line keeps its real height.
  return (
    <div role="status" aria-label="Loading calendar" className="flex gap-1.5 mb-3">
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} aria-hidden="true" className="flex-1 flex flex-col items-center rounded-xl py-2 px-0.5 border border-slate-800 bg-card">
          <div className="text-[9px] font-semibold tracking-wider mb-1.5"><SkeletonText text="SUN" /></div>
          <div className="skeleton size-7 rounded-full mb-1.5" />
          <div className="skeleton w-6 h-[3px] rounded-full mb-1" />
          <div className="mb-0.5 h-[14px] flex items-center justify-center"><div className="skeleton size-[13px] rounded" /></div>
          <div className="text-[9px] font-semibold tracking-wider leading-tight"><SkeletonText text="MID" /></div>
          <div className="text-[8px] mt-0.5 leading-tight min-h-5"><SkeletonText text="7a–3p" /></div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonDetailCard() {
  // The day card with a shift: its label row (24px), the times (32px) and the
  // hours (20px) — the same lines and gaps as the card itself.
  return (
    <div role="status" aria-label="Loading shift details" className="bg-card rounded-2xl px-4 py-4 mb-3 mt-1 border border-slate-800/60">
      <div className="h-6 mb-1 flex items-center"><div className="skeleton h-[13px] w-28 rounded" /></div>
      <div className="h-8 mt-1 flex items-center"><div className="skeleton h-7 w-44 rounded" /></div>
      <div className="h-5 mt-0.5 flex items-center"><div className="skeleton h-[10px] w-12 rounded" /></div>
    </div>
  );
}

export function SkeletonClockBody() {
  // The clock while clocked in, block for block: today's shift (its label row
  // and the times), the status card (pill, timer, caption) and the two
  // punch buttons — the same lines, gaps and borders.
  return (
    <div role="status" aria-label="Loading clock" className="mt-4 space-y-3">
      <div className="bg-card rounded-2xl px-4 py-4 border-l-[3px] border border-slate-800/60">
        <div className="h-5 flex items-center justify-between">
          <div className="skeleton h-[10px] w-24 rounded" />
          <div className="skeleton h-5 w-16 rounded-full" />
        </div>
        <div className="h-8 mt-1.5 flex items-center"><div className="skeleton h-7 w-40 rounded" /></div>
      </div>
      <div className="bg-card rounded-2xl px-4 py-5 border border-slate-800/60 flex flex-col items-center">
        <div className="skeleton h-[34px] w-32 rounded-full mb-3" />
        <div className="h-10 flex items-center"><div className="skeleton h-9 w-36 rounded" /></div>
        <div className="h-4 mt-1 flex items-center"><div className="skeleton h-3 w-40 rounded" /></div>
      </div>
      <div className="skeleton h-[58px] w-full rounded-2xl" />
    </div>
  );
}

export function SkeletonSettingsBody({ isManager }: { isManager?: boolean }) {
  const sectionCount = isManager ? 5 : 2;
  return (
    <div role="status" aria-label="Loading settings" className="px-4 pt-5 flex flex-col gap-5">
      {Array.from({ length: sectionCount }, (_, i) => (
        <div key={i}>
          <div className="skeleton h-[10px] w-28 rounded mb-2 ml-1" />
          <div className="bg-card rounded-2xl border border-slate-800/60 px-4 py-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-1.5">
                <div className="skeleton h-[14px] w-36 rounded" />
                <div className="skeleton h-[10px] w-48 rounded" />
              </div>
              {i % 2 === 0 ? (
                <div className="skeleton h-6 w-11 rounded-full" />
              ) : (
                <div className="skeleton h-8 w-24 rounded-xl" />
              )}
            </div>
            {i === 0 && (
              <div className="flex items-center justify-between">
                <div className="space-y-1.5">
                  <div className="skeleton h-[14px] w-36 rounded" />
                  <div className="skeleton h-[10px] w-48 rounded" />
                </div>
                <div className="skeleton h-6 w-11 rounded-full" />
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonBudgetChart() {
  // The same box as DraftCoverageChart (the Week page's Budget vs Scheduled):
  // its header with the By Day / By Hour toggle, the legend pills, the chart
  // (2.6:1, 190-300px) and the "Edit coverage targets" link under it.
  return (
    <div role="status" aria-label="Loading budget chart" className="bg-card rounded-2xl pt-4 px-[10px] pb-[10px] mb-4">
      <div aria-hidden="true" className="flex items-center justify-between mb-2 pl-1.5 pr-1 gap-2 flex-wrap">
        {/* The title in its own font, so the header wraps where the chart's does. */}
        <div className="text-[11px] font-bold tracking-[0.1em] uppercase">
          <SkeletonText text="Budget vs Scheduled" />
        </div>
        <div className="flex rounded-lg bg-slate-800/60 border border-slate-700/40 p-0.5">
          {["By Day", "By Hour"].map((label) => (
            <span key={label} data-text={label} className="min-h-8 px-3 flex items-center text-[11px] font-semibold text-transparent before:content-[attr(data-text)]" />
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="flex flex-wrap items-center gap-2 mb-3 pl-1.5">
        {["Scheduled hrs", "Budget hrs"].map((label) => (
          <span key={label} data-text={label} className="skeleton flex items-center text-[11px] text-transparent px-2 py-0.5 rounded-full border border-transparent before:content-[attr(data-text)]" />
        ))}
      </div>
      <div aria-hidden="true" className="w-full min-w-0 aspect-[2.6/1] min-h-[190px] max-h-[300px] flex items-end gap-3 px-6 pt-6 pb-10">
        {[55, 70, 62, 80, 74, 90, 66].map((h, i) => (
          <div key={i} className="skeleton flex-1 rounded-t-[3px]" style={{ height: `${h}%` }} />
        ))}
      </div>
      <div aria-hidden="true" className="flex justify-end pr-1 mt-1">
        <div className="min-h-8" />
      </div>
    </div>
  );
}

export function SkeletonTimeline() {
  // The same box as CoverageTimeline: its header (the title, then a row of
  // legend pills on phones; one line from tablets up) and its chart area
  // (3:1, 150-300px).
  return (
    <div role="status" aria-label="Loading coverage timeline" className="bg-card rounded-2xl pt-4 px-[10px] pb-[10px] mb-4">
      <div aria-hidden="true" className="flex flex-col gap-1 mb-3 pl-1.5 pr-1 tablet:flex-row tablet:items-center tablet:justify-between">
        <p className="text-[11px] font-bold tracking-[0.1em] uppercase">
          <SkeletonText text="Coverage Timeline" />
        </p>
        <div className="h-[21px]" />
      </div>
      <div aria-hidden="true" className="w-full min-w-0 aspect-[3/1] min-h-[150px] max-h-[300px] flex flex-col justify-end gap-1 pb-[10px]">
        <div className="flex items-end gap-[3px] flex-1 min-h-0 px-2 pt-7 pb-5">
          {[40, 55, 65, 70, 75, 80, 75, 72, 68, 70, 72, 75, 78, 80, 76, 70, 65, 60, 55, 50, 45, 42, 38, 35, 30, 28, 25, 22, 20, 18, 16, 14].map(
            (h, i) => (
              <div
                key={i}
                className="skeleton flex-1 rounded-t-[3px]"
                style={{ height: `${h}%` }}
              />
            )
          )}
        </div>
        <div className="flex justify-between px-2">
          {[80, 60, 60, 60, 56].map((w, i) => (
            <div key={i} className="skeleton h-[9px] rounded" style={{ width: w }} />
          ))}
        </div>
      </div>
    </div>
  );
}
