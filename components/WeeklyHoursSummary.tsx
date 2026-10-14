"use client";

// Read-only summary of each employee's scheduled hours for a week, highlighting
// anyone scheduled into overtime (> 40h). Presentational: the caller fetches
// /api/reports/scheduled-hours and passes the rows in.

export type WeeklyHoursRow = {
  employeeId: number;
  employeeName: string;
  totalMinutes: number;
  totalHours: number;
  overtimeMinutes: number;
  isOvertime: boolean;
};

function fmtHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export default function WeeklyHoursSummary({
  employees,
  thresholdMinutes = 2400,
}: {
  employees: WeeklyHoursRow[];
  thresholdMinutes?: number;
}) {
  const overtimeCount = employees.filter((e) => e.isOvertime).length;

  return (
    <div data-testid="weekly-hours-summary" className="flex flex-col gap-2">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] text-fg-muted font-semibold tracking-wider uppercase">
          Scheduled Hours
        </div>
        {overtimeCount > 0 && (
          <div className="text-[11px] font-semibold text-warning-fg">
            {overtimeCount} in overtime
          </div>
        )}
      </div>

      {employees.length === 0 ? (
        <div className="text-center py-6 text-fg-muted text-sm">No one scheduled this week</div>
      ) : (
        employees.map((e) => (
          <div
            key={e.employeeId}
            data-testid={`weekly-hours-row-${e.employeeId}`}
            className={`flex items-center justify-between rounded-xl px-3 py-2.5 border ${
              e.isOvertime
                ? "bg-warning/10 border-warning/30"
                : "bg-card border-line/60"
            }`}
          >
            <span className="text-sm font-medium text-fg">{e.employeeName}</span>
            <span className="flex items-center gap-2">
              {e.isOvertime && (
                <span
                  aria-label={`Overtime: ${fmtHours(e.overtimeMinutes)} over`}
                  className="text-[10px] font-bold uppercase tracking-wide text-warning-fg-strong bg-warning/20 rounded-full px-2 py-0.5"
                >
                  OT +{fmtHours(e.overtimeMinutes)}
                </span>
              )}
              <span
                className={`text-sm font-semibold tabular-nums ${
                  e.isOvertime ? "text-warning-fg-strong" : "text-fg-secondary"
                }`}
              >
                {fmtHours(e.totalMinutes)}
              </span>
            </span>
          </div>
        ))
      )}

      <div className="text-[10px] text-fg-subtle mt-1">
        Overtime above {Math.round(thresholdMinutes / 60)}h/week
      </div>
    </div>
  );
}
