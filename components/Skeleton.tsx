"use client";

export function SkeletonShiftCard() {
  return (
    <div aria-hidden="true" className="flex items-center gap-3 w-full bg-card border border-slate-800 border-l-[3px] border-l-slate-800 rounded-xl px-[14px] py-3 mb-2">
      <div className="skeleton size-[38px] rounded-full shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="skeleton h-[13px] w-[55%] rounded" />
        <div className="skeleton h-[10px] w-[28%] rounded mt-[7px]" />
      </div>
      <div className="text-right shrink-0">
        <div className="skeleton h-[10px] w-20 rounded" />
      </div>
    </div>
  );
}

export function SkeletonTeamSection({ count = 4 }: { count?: number }) {
  return (
    <div role="status" aria-label="Loading schedule" className="mb-5">
      <div aria-hidden="true" className="flex items-center gap-2 mb-2.5">
        <div className="skeleton h-3 w-20 rounded" />
        <div className="skeleton h-[18px] w-7 rounded-full" />
      </div>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonShiftCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonNextShift() {
  return (
    <div role="status" aria-label="Loading next shift" className="space-y-2">
      <div className="skeleton h-[14px] w-24 rounded" />
      <div className="skeleton h-7 w-44 rounded" />
    </div>
  );
}

export function SkeletonWeekCalendar() {
  return (
    <div role="status" aria-label="Loading calendar" className="flex gap-1.5 mb-3">
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="flex-1 flex flex-col items-center rounded-xl py-2 px-0.5 border border-slate-800 bg-card">
          <div className="skeleton h-[9px] w-5 rounded mb-1.5" />
          <div className="skeleton size-7 rounded-full mb-1.5" />
          <div className="skeleton w-6 h-[3px] rounded-full mb-2" />
          <div className="skeleton size-[13px] rounded mb-1" />
          <div className="skeleton h-[9px] w-5 rounded" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonDetailCard() {
  return (
    <div role="status" aria-label="Loading shift details" className="bg-card rounded-2xl px-4 py-4 mb-3 mt-1 border border-slate-800/60">
      <div className="skeleton h-[13px] w-28 rounded mb-2" />
      <div className="skeleton h-8 w-44 rounded mt-1" />
      <div className="skeleton h-[10px] w-12 rounded mt-2" />
    </div>
  );
}

export function SkeletonStatsRow() {
  return (
    <div role="status" aria-label="Loading stats" className="flex gap-2">
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className="flex-1 bg-card border border-slate-800/60 rounded-2xl px-3 py-4">
          <div className="skeleton h-8 w-10 rounded mb-1" />
          <div className="skeleton h-[10px] w-20 rounded mt-1" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonClockBody() {
  return (
    <div role="status" aria-label="Loading clock" className="mt-4 space-y-3">
      <div className="bg-card rounded-2xl px-4 py-4 border-l-[3px] border border-slate-800/60">
        <div className="flex items-center justify-between mb-1.5">
          <div className="skeleton h-[10px] w-24 rounded" />
          <div className="skeleton h-5 w-16 rounded-full" />
        </div>
        <div className="skeleton h-7 w-40 rounded mt-1.5" />
      </div>
      <div className="bg-card rounded-2xl px-4 py-5 border border-slate-800/60 flex flex-col items-center gap-3">
        <div className="skeleton h-7 w-32 rounded-full" />
        <div className="skeleton h-10 w-36 rounded" />
        <div className="skeleton h-3 w-40 rounded" />
      </div>
      <div className="skeleton h-14 w-full rounded-2xl" />
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

export function SkeletonTimeline() {
  return (
    <div role="status" aria-label="Loading coverage timeline" className="bg-card rounded-2xl pt-4 px-[10px] pb-[10px] mb-4">
      <div className="skeleton h-[11px] w-40 rounded mb-4 ml-1.5" />
      <div className="flex flex-col justify-end gap-1 h-[150px] pb-[10px]">
        <div className="flex items-end gap-[3px] h-full px-2 pt-7 pb-5">
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
