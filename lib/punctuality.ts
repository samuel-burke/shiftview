// Pure punctuality classification: compare when someone actually clocked in to
// their scheduled start. The data join (punches → shifts, timezone-aware) lives
// in the route; this keeps the rule and the aggregation testable. Minutes are
// minutes since midnight (local).

export type ArrivalStatus = "on_time" | "late" | "absent";

// `clockInMinutes` is the earliest clock-in for the shift (local minute-of-day),
// or null if they never clocked in. Arriving within `graceMinutes` of the start
// counts as on time.
export function classifyArrival(
  scheduledStartMinutes: number,
  clockInMinutes: number | null,
  graceMinutes: number
): ArrivalStatus {
  if (clockInMinutes == null) return "absent";
  return clockInMinutes > scheduledStartMinutes + graceMinutes ? "late" : "on_time";
}

export type PunctualitySummary = {
  total: number;
  onTime: number;
  late: number;
  absent: number;
  // Percentage of those who showed up (on_time + late) who were on time.
  onTimeRate: number;
};

export function summarizePunctuality(rows: { status: ArrivalStatus }[]): PunctualitySummary {
  let onTime = 0, late = 0, absent = 0;
  for (const r of rows) {
    if (r.status === "on_time") onTime++;
    else if (r.status === "late") late++;
    else absent++;
  }
  const showed = onTime + late;
  return {
    total: rows.length,
    onTime,
    late,
    absent,
    onTimeRate: showed === 0 ? 0 : Math.round((onTime / showed) * 100),
  };
}
