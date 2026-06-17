// Pure equity analysis of scheduled hours: how evenly work is distributed across
// the team for a week. Complements the legal (overtime) and dollar (labor cost)
// views — this one is about fairness, flagging who's getting noticeably fewer or
// more hours than the team average. Minutes throughout.

export type EmployeeMinutes = { employeeId: number; totalMinutes: number };

export type FairnessSummary = {
  count: number;
  totalMinutes: number;
  meanMinutes: number;
  minMinutes: number;
  maxMinutes: number;
  spreadMinutes: number;
};

export function fairnessSummary(employees: EmployeeMinutes[]): FairnessSummary {
  if (employees.length === 0) {
    return { count: 0, totalMinutes: 0, meanMinutes: 0, minMinutes: 0, maxMinutes: 0, spreadMinutes: 0 };
  }
  const totals = employees.map((e) => e.totalMinutes);
  const totalMinutes = totals.reduce((a, b) => a + b, 0);
  const minMinutes = Math.min(...totals);
  const maxMinutes = Math.max(...totals);
  return {
    count: employees.length,
    totalMinutes,
    meanMinutes: Math.round(totalMinutes / employees.length),
    minMinutes,
    maxMinutes,
    spreadMinutes: maxMinutes - minMinutes,
  };
}

export type FairnessStatus = "under" | "fair" | "over";

export type FairnessRow = {
  employeeId: number;
  totalMinutes: number;
  deviationMinutes: number; // total - mean
  status: FairnessStatus;
};

// Default tolerance band around the mean (minutes) before an employee is flagged
// under/over — 8h, i.e. roughly a full shift away from average.
export const DEFAULT_FAIRNESS_TOLERANCE = 480;

// Classify each employee relative to the team mean. Sorted by total desc.
export function classifyFairness(
  employees: EmployeeMinutes[],
  toleranceMinutes: number = DEFAULT_FAIRNESS_TOLERANCE
): FairnessRow[] {
  const { meanMinutes } = fairnessSummary(employees);
  const rows = employees.map((e) => {
    const deviationMinutes = e.totalMinutes - meanMinutes;
    let status: FairnessStatus = "fair";
    if (deviationMinutes <= -toleranceMinutes) status = "under";
    else if (deviationMinutes >= toleranceMinutes) status = "over";
    return { employeeId: e.employeeId, totalMinutes: e.totalMinutes, deviationMinutes, status };
  });
  rows.sort((a, b) => b.totalMinutes - a.totalMinutes || a.employeeId - b.employeeId);
  return rows;
}
