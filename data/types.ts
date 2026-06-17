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
  opener: "var(--color-shift-opener)",
  mid:    "var(--color-shift-mid)",
  closer: "var(--color-shift-closer)",
};

export const TIME_OFF_COLORS: Record<TimeOffRequest["status"], string> = {
  pending:  "var(--color-timeoff-pending)",
  approved: "var(--color-timeoff-approved)",
  denied:   "var(--color-timeoff-denied)",
};

// Live status against the day's target coverage curve (see lib/coverage.ts).
export type CoverageStatus = "optimal" | "low" | "critical" | "closed";
export type StoreHours = { open: number; close: number };

export function fmtMinutes(m: number): string {
  if (m < 0) return "";
  const h = Math.floor(m / 60);
  const min = m % 60;
  const ampm = h >= 12 && h < 24 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return min === 0
    ? `${h12}:00 ${ampm}`
    : `${h12}:${String(min).padStart(2, "0")} ${ampm}`;
}

export type AvailabilityRecord = {
  id: number;
  dayOfWeek: number;
  startMinutes: number | null; // null = unavailable all day
  endMinutes: number | null;
  note: string | null;
};

export type TimeOffRequest = {
  id: number;
  date: string;       // YYYY-MM-DD
  status: "pending" | "approved" | "denied";
  note?: string;
};

// An employee calling out — they can't make it to work on `date`. Unlike a
// time-off request this carries no approval status: it's effective immediately
// and simply reflects "Called Out" across the app until rescinded.
export type Callout = {
  id: number;
  employeeId: number;
  employeeName?: string;
  date: string;       // YYYY-MM-DD
  reason?: string;
};

// Red, consistent with the denied/absent tone used elsewhere in the UI.
export const CALLOUT_COLOR = "var(--color-timeoff-denied)";

// An open shift — an unassigned slot a manager posts for employees to pick up
// (see lib/open-shifts.ts). Times are minutes since midnight.
export type OpenShiftStatus = "open" | "filled" | "cancelled";
export type ClaimStatus = "pending" | "approved" | "denied";

export type OpenShift = {
  id: number;
  date: string;        // YYYY-MM-DD
  startMinutes: number;
  endMinutes: number;
  note?: string | null;
  status: OpenShiftStatus;
  filledBy?: number | null;     // employee id once filled
  filledByName?: string | null;
  claims?: OpenShiftClaim[];
};

export type OpenShiftClaim = {
  id: number;
  openShiftId: number;
  employeeId: number;
  employeeName?: string;
  status: ClaimStatus;
};

export type PunchType = "clock_in" | "clock_out" | "break_start" | "break_end";
export type AttendanceStatus = "clocked_in" | "on_break" | "clocked_out" | "not_clocked_in";

export type PunchRecord = {
  id: number;
  employeeId: number;
  scheduleId: number | null;
  punchType: PunchType;
  punchedAt: string; // ISO timestamptz
  lat: number | null;
  lng: number | null;
  isManual: boolean;
  note: string | null;
};

export function getAttendanceStatus(punches: PunchRecord[]): AttendanceStatus {
  if (!punches.length) return "not_clocked_in";
  const sorted = [...punches].sort(
    (a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime()
  );
  const latest = sorted[sorted.length - 1];
  switch (latest.punchType) {
    case "clock_in":    return "clocked_in";
    case "clock_out":   return "clocked_out";
    case "break_start": return "on_break";
    case "break_end":   return "clocked_in";
  }
}

export function getTotalClockedSeconds(punches: PunchRecord[], now = Date.now()): number {
  const sorted = [...punches].sort(
    (a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime()
  );
  let total = 0;
  let segStart: number | null = null;
  for (const p of sorted) {
    const t = new Date(p.punchedAt).getTime();
    if (p.punchType === "clock_in" || p.punchType === "break_end") {
      segStart = t;
    } else if ((p.punchType === "clock_out" || p.punchType === "break_start") && segStart !== null) {
      total += t - segStart;
      segStart = null;
    }
  }
  if (segStart !== null) total += now - segStart;
  return Math.floor(total / 1000);
}

export function getBreakElapsedSeconds(punches: PunchRecord[], now = Date.now()): number {
  const sorted = [...punches].sort(
    (a, b) => new Date(a.punchedAt).getTime() - new Date(b.punchedAt).getTime()
  );
  let breakStart: number | null = null;
  for (const p of sorted) {
    if (p.punchType === "break_start") {
      breakStart = new Date(p.punchedAt).getTime();
    } else if (p.punchType === "break_end") {
      breakStart = null;
    }
  }
  if (breakStart === null) return 0;
  return Math.floor((now - breakStart) / 1000);
}

export function fmtElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}
