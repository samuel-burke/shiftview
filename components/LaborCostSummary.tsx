"use client";

// Read-only weekly labor-cost summary. Presentational: the caller fetches
// /api/reports/labor-cost and passes the rows + totals in.

export type LaborCostRow = {
  employeeId: number;
  employeeName: string;
  totalHours: number;
  overtimeMinutes: number;
  payRate: number | null;
  cost: number | null;
};

function fmtUSD(amount: number): string {
  return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function LaborCostSummary({
  employees,
  totalCost,
  employeesMissingRate = 0,
}: {
  employees: LaborCostRow[];
  totalCost: number;
  employeesMissingRate?: number;
}) {
  return (
    <div data-testid="labor-cost-summary" className="flex flex-col gap-2">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] text-fg-muted font-semibold tracking-wider uppercase">
          Labor Cost
        </div>
        <div className="text-sm font-bold text-fg tabular-nums" data-testid="labor-cost-total">
          {fmtUSD(totalCost)}
        </div>
      </div>

      {employeesMissingRate > 0 && (
        <div className="text-[11px] text-warning-fg font-medium">
          {employeesMissingRate} {employeesMissingRate === 1 ? "employee has" : "employees have"} no pay rate set
        </div>
      )}

      {employees.length === 0 ? (
        <div className="text-center py-6 text-fg-muted text-sm">No one scheduled this week</div>
      ) : (
        employees.map((e) => (
          <div
            key={e.employeeId}
            data-testid={`labor-cost-row-${e.employeeId}`}
            className="flex items-center justify-between rounded-xl px-3 py-2.5 border bg-card border-line/60"
          >
            <span className="flex flex-col">
              <span className="text-sm font-medium text-fg">{e.employeeName}</span>
              <span className="text-[11px] text-fg-subtle">
                {e.totalHours}h
                {e.overtimeMinutes > 0 && (
                  <span className="text-warning-fg"> · {Math.round((e.overtimeMinutes / 60) * 10) / 10}h OT</span>
                )}
              </span>
            </span>
            {e.cost == null ? (
              <span className="text-xs font-semibold text-warning-fg">Set rate</span>
            ) : (
              <span className="text-sm font-semibold text-fg-body tabular-nums">{fmtUSD(e.cost)}</span>
            )}
          </div>
        ))
      )}
    </div>
  );
}
