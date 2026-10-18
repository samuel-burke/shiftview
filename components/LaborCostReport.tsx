"use client";

// Scheduled vs actual labor cost for one week, by day and by employee.
// Presentational: the caller fetches /api/reports/labor-cost and passes the
// body through toLaborCostReportData.
//
// Scheduled cost is scheduled time at the rate in effect; actual cost is
// punched hours (as payroll counts them) at the rate in effect when they were
// worked, with overtime at 1.5× and double time at 2×.

export type LaborCostReportData = {
  weekStart: string;
  scheduledTotal: number;
  actualTotal: number;
  scheduledMissingRate: number;
  actualMissingRate: number;
  hasIncomplete: boolean;
  days: { date: string; scheduledCost: number; actualCost: number }[];
  employees: {
    employeeId: number;
    employeeName: string;
    scheduledCost: number | null;
    scheduledHours: number;
    actualCost: number | null;
    actualHours: number;
    overtimeHours: number;
  }[];
};

const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// The API body as the report needs it; null when it isn't a labor-cost body.
export function toLaborCostReportData(body: unknown): LaborCostReportData | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (typeof b.weekStart !== "string" || !Array.isArray(b.days) || !Array.isArray(b.employees)) return null;
  const actual = b.actual && typeof b.actual === "object" ? b.actual : { employees: [] };
  const byId = new Map<number, LaborCostReportData["employees"][number]>();
  for (const e of b.employees) {
    byId.set(Number(e.employeeId), {
      employeeId: Number(e.employeeId),
      employeeName: String(e.employeeName ?? "Unknown"),
      scheduledCost: numOrNull(e.cost),
      scheduledHours: num(e.totalHours),
      actualCost: null,
      actualHours: 0,
      overtimeHours: 0,
    });
  }
  for (const a of Array.isArray(actual.employees) ? actual.employees : []) {
    const id = Number(a.employeeId);
    const row = byId.get(id) ?? {
      employeeId: id, employeeName: String(a.employeeName ?? "Unknown"),
      scheduledCost: null, scheduledHours: 0, actualCost: null, actualHours: 0, overtimeHours: 0,
    };
    row.actualCost = numOrNull(a.cost);
    row.actualHours = num(a.totalHours);
    row.overtimeHours = num(a.overtimeHours) + num(a.doubleTimeHours);
    byId.set(id, row);
  }
  return {
    weekStart: b.weekStart,
    scheduledTotal: num(b.totalCost),
    actualTotal: num(actual.totalCost),
    scheduledMissingRate: num(b.employeesMissingRate),
    actualMissingRate: num(actual.employeesMissingRate),
    hasIncomplete: actual.hasIncomplete === true,
    days: b.days.map((d: Record<string, unknown>) => ({
      date: String(d.date), scheduledCost: num(d.scheduledCost), actualCost: num(d.actualCost),
    })),
    employees: [...byId.values()].sort(
      (x, y) => (y.actualCost ?? y.scheduledCost ?? -1) - (x.actualCost ?? x.scheduledCost ?? -1) || x.employeeName.localeCompare(y.employeeName)
    ),
  };
}

export function fmtUSD(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function dayLabel(date: string): string {
  return new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "UTC" });
}

function Diff({ scheduled, actual }: { scheduled: number; actual: number }) {
  const d = Math.round((actual - scheduled) * 100) / 100;
  if (d === 0 || scheduled === 0) return null;
  return (
    <span className={`text-[10px] ${d > 0 ? "text-warning-fg" : "text-success-fg"}`}>
      {d > 0 ? "+" : "−"}{fmtUSD(Math.abs(d))}
    </span>
  );
}

export default function LaborCostReport({ data }: { data: LaborCostReportData }) {
  const missing = Math.max(data.scheduledMissingRate, data.actualMissingRate);
  return (
    <div data-testid="labor-cost-report" className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <div className="text-[11px] text-fg-muted font-semibold tracking-wider uppercase">Labor cost</div>
        <div className="text-[11px] text-fg-subtle">Scheduled · Actual</div>
      </div>

      <div className="bg-card rounded-2xl border border-line/60 overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 py-2 border-b border-line/60 bg-fill/30 text-[10px] text-fg-subtle font-semibold">
          <div>Day</div>
          <div className="text-right w-20">Scheduled</div>
          <div className="text-right w-24">Actual</div>
        </div>
        {data.days.map((d) => (
          <div key={d.date} data-testid={`labor-cost-day-${d.date}`} className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 py-1.5 border-b border-line/60 text-xs tabular-nums">
            <div className="text-fg-body">{dayLabel(d.date)}</div>
            <div className="text-right w-20 text-fg-muted">{d.scheduledCost ? fmtUSD(d.scheduledCost) : "-"}</div>
            <div className="text-right w-24 text-fg-body flex items-center justify-end gap-1">
              {d.actualCost ? fmtUSD(d.actualCost) : "-"}
            </div>
          </div>
        ))}
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 py-2 text-xs font-bold tabular-nums bg-fill/30">
          <div className="text-fg">Week</div>
          <div className="text-right w-20 text-fg-secondary" data-testid="labor-cost-scheduled-total">{fmtUSD(data.scheduledTotal)}</div>
          <div className="text-right w-24 text-fg flex flex-col items-end" data-testid="labor-cost-actual-total">
            {fmtUSD(data.actualTotal)}
            <Diff scheduled={data.scheduledTotal} actual={data.actualTotal} />
          </div>
        </div>
      </div>

      {(missing > 0 || data.hasIncomplete) && (
        <div className="text-[11px] text-warning-fg px-1 leading-snug flex flex-col gap-0.5">
          {missing > 0 && (
            <span>{missing} {missing === 1 ? "employee has" : "employees have"} hours with no pay rate set (counted as nothing).</span>
          )}
          {data.hasIncomplete && <span>Some punches don&apos;t pair up; actual cost counts only the paired time.</span>}
        </div>
      )}

      {data.employees.length > 0 && (
        <div className="bg-card rounded-2xl border border-line/60 overflow-hidden">
          {data.employees.map((e) => (
            <div key={e.employeeId} data-testid={`labor-cost-employee-${e.employeeId}`} className="grid grid-cols-[1fr_auto_auto] gap-x-4 px-3 py-2 border-b border-line/60 last:border-b-0 text-xs tabular-nums">
              <div className="flex flex-col min-w-0">
                <span className="text-fg-body font-medium truncate">{e.employeeName}</span>
                <span className="text-[10px] text-fg-subtle">
                  {e.scheduledHours}h sched · {e.actualHours}h worked
                  {e.overtimeHours > 0 && <span className="text-warning-fg"> · {e.overtimeHours}h OT</span>}
                </span>
              </div>
              <div className="text-right w-20 text-fg-muted self-center">
                {e.scheduledCost == null ? (e.scheduledHours > 0 ? <span className="text-warning-fg">No rate</span> : "-") : fmtUSD(e.scheduledCost)}
              </div>
              <div className="text-right w-24 text-fg-body self-center">
                {e.actualCost == null ? (e.actualHours > 0 ? <span className="text-warning-fg">No rate</span> : "-") : fmtUSD(e.actualCost)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
