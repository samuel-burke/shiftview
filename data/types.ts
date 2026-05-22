export type ShiftType = "opener" | "mid" | "closer";

export type Employee = {
  id: number;
  name: string;
  avatar: string;
};

export type Schedule = {
  id: number;
  employeeId: number;
  date: string;
  startMinutes: number;
  endMinutes: number;
};

// Derived — computed from start time, not stored
export function getShiftType(startMinutes: number): ShiftType | null {
  if (startMinutes < 0) return null;
  if (startMinutes < 540) return "opener"; // before 9am
  if (startMinutes < 720) return "mid";    // 9am–noon
  return "closer";                          // noon+
}

export function isHere(s: Schedule, nowMinutes: number): boolean {
  return s.startMinutes >= 0 && nowMinutes >= s.startMinutes && nowMinutes < s.endMinutes;
}

export const SHIFT_COLORS: Record<ShiftType, string> = {
  opener: "#f59e0b",
  mid:    "#6366f1",
  closer: "#8b5cf6",
};

export const OPTIMAL_COVERAGE = 3;
export const MINIMUM_COVERAGE = 2;
export type CoverageStatus = "optimal" | "low" | "critical" | "closed";

export function getDayCoverageStatus(
  schedules: Schedule[],
  date: Date
): CoverageStatus {
  const day = date.getDay(); // 0 = Sunday
  const openMinutes  = day === 0 ? 480  : 360;  // 8am Sun, 6am Mo-Sa
  const closeMinutes = day === 0 ? 1200 : 1320; // 8pm Sun, 10pm Mo-Sa

  const scheduled = schedules.filter((s) => s.startMinutes >= 0);

  let minCoverage = Infinity;

  for (let t = openMinutes; t < closeMinutes; t += 30) {
    const count = scheduled.filter(
      (s) => t >= s.startMinutes && t < s.endMinutes
    ).length;
    minCoverage = Math.min(minCoverage, count);
  }

  if (minCoverage === Infinity || minCoverage === 0) return "critical";
  if (minCoverage < MINIMUM_COVERAGE) return "critical";
  if (minCoverage < OPTIMAL_COVERAGE) return "low";
  return "optimal";
}

export function fmtMinutes(m: number): string {
  if (m < 0) return "";
  const h = Math.floor(m / 60);
  const min = m % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return min === 0
    ? `${h12}:00 ${ampm}`
    : `${h12}:${String(min).padStart(2, "0")} ${ampm}`;
}
