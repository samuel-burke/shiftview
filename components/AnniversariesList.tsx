"use client";

// Read-only list of upcoming work anniversaries. Presentational — the parent
// fetches /api/reports/anniversaries.

export type Anniversary = {
  employeeId: number;
  employeeName: string;
  date: string;
  daysUntil: number;
  years: number;
};

function whenLabel(daysUntil: number): string {
  if (daysUntil === 0) return "Today";
  if (daysUntil === 1) return "Tomorrow";
  return `in ${daysUntil} days`;
}

export default function AnniversariesList({ anniversaries }: { anniversaries: Anniversary[] }) {
  return (
    <div data-testid="anniversaries" className="flex flex-col gap-2">
      <div className="text-[11px] text-fg-muted font-semibold tracking-wider uppercase">
        Work Anniversaries
      </div>

      {anniversaries.length === 0 ? (
        <div className="text-center py-6 text-fg-muted text-sm">None coming up</div>
      ) : (
        anniversaries.map((a) => (
          <div
            key={a.employeeId}
            data-testid={`anniversary-${a.employeeId}`}
            className={`flex items-center justify-between rounded-xl px-3 py-2.5 border ${
              a.daysUntil === 0 ? "bg-accent/15 border-accent/40" : "bg-card border-line/60"
            }`}
          >
            <span className="flex items-center gap-2 text-sm font-medium text-fg">
              <span aria-hidden="true">🎉</span>
              {a.employeeName}
              <span className="text-[11px] font-normal text-fg-muted">
                {a.years} {a.years === 1 ? "year" : "years"}
              </span>
            </span>
            <span className={`text-xs font-semibold ${a.daysUntil === 0 ? "text-accent-fg-strong" : "text-fg-muted"}`}>
              {whenLabel(a.daysUntil)}
            </span>
          </div>
        ))
      )}
    </div>
  );
}
