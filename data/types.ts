export type ShiftType = "opener" | "mid" | "closer";

export type Employee = {
  id: number;
  name: string;
  email?: string;
  user_id?: string | null;
};

export function formatDisplayName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export function getMonogram(name: string): string {
  const words = name.split(" ").filter(Boolean);
  const initials = words.length === 1
    ? [words[0]]
    : [words[0], words[words.length - 1]];
  return initials.map((w) => w[0].toUpperCase()).join("");
}

export type Schedule = {
  id: number;
  employeeId: number;
  date: string;
  startMinutes: number;
  endMinutes: number;
};

// Derived — computed from clock-in/out times and store hours
export function getShiftType(startMinutes: number, endMinutes: number, openMinutes: number, closeMinutes: number): ShiftType | null {
  if (startMinutes < 0) return null;
  if (startMinutes <= openMinutes + 60) return "opener";
  if (endMinutes >= closeMinutes - 60) return "closer";
  return "mid";
}

export function isHere(s: Schedule, nowMinutes: number): boolean {
  return nowMinutes >= s.startMinutes && nowMinutes < s.endMinutes;
}

export const SHIFT_COLORS: Record<ShiftType, string> = {
  opener: "#f59e0b",
  mid:    "#34d399",
  closer: "#a78bfa",
};

export const OPTIMAL_COVERAGE = 3;
export const MINIMUM_COVERAGE = 2;
export type CoverageStatus = "optimal" | "low" | "critical" | "closed";
export type StoreHours = { open: number; close: number };

export function getDayCoverageStatus(
  schedules: Schedule[],
  storeHours: StoreHours
): CoverageStatus {
  const { open: openMinutes, close: closeMinutes } = storeHours;

  let minCoverage = Infinity;

  for (let t = openMinutes; t < closeMinutes; t += 30) {
    const count = schedules.filter(
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
