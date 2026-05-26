"use client";

export function SkeletonShiftCard() {
  return (
    <div className="flex items-center gap-3 w-full bg-gray-900 border border-slate-800 border-l-[3px] border-l-slate-800 rounded-xl px-[14px] py-3 mb-2">
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
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2.5">
        <div className="skeleton h-3 w-20 rounded" />
        <div className="skeleton h-[18px] w-7 rounded-full" />
      </div>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonShiftCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonTimeline() {
  return (
    <div className="bg-card rounded-2xl pt-4 px-[10px] pb-[10px] mb-4">
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
