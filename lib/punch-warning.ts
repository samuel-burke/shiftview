import type { Schedule, PunchType } from "@/data/types";

export type PunchWarning = {
  heading: string;
  body: string;
  /** Minutes by which the punch is early (negative) or late (positive) */
  diffMinutes: number;
};

const THRESHOLD = 6;

/**
 * Returns a warning to show before recording a punch, or null if no warning
 * is needed. Compares nowMinutes against the scheduled start (clock_in) or
 * end (clock_out) in the store's local timezone.
 */
export function getPunchWarning(
  punchType: PunchType,
  nowMinutes: number,
  schedule: Schedule | null
): PunchWarning | null {
  if (!schedule) return null;

  if (punchType === "clock_in") {
    const diff = nowMinutes - schedule.startMinutes;
    if (diff > THRESHOLD) {
      return {
        heading: "Late Clock-In",
        body: `Your shift started at ${fmtMin(schedule.startMinutes)}. You're clocking in ${diff} min late.`,
        diffMinutes: diff,
      };
    }
    if (diff < -THRESHOLD) {
      return {
        heading: "Early Clock-In",
        body: `Your shift starts at ${fmtMin(schedule.startMinutes)}. You're clocking in ${Math.abs(diff)} min early.`,
        diffMinutes: diff,
      };
    }
    return null;
  }

  if (punchType === "clock_out") {
    const diff = nowMinutes - schedule.endMinutes;
    if (diff > THRESHOLD) {
      return {
        heading: "Late Clock-Out",
        body: `Your shift ended at ${fmtMin(schedule.endMinutes)}. You're clocking out ${diff} min late.`,
        diffMinutes: diff,
      };
    }
    if (diff < -THRESHOLD) {
      return {
        heading: "Early Clock-Out",
        body: `Your shift ends at ${fmtMin(schedule.endMinutes)}. You're clocking out ${Math.abs(diff)} min early.`,
        diffMinutes: diff,
      };
    }
    return null;
  }

  return null;
}

function fmtMin(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
}
