import { fmtMinutes, type Schedule, type PunchType } from "@/data/types";
import { minutesFromScheduled } from "@/lib/dates";

export type PunchWarning = {
  heading: string;
  body: string;
  /** Minutes by which the punch is early (negative) or late (positive) */
  diffMinutes: number;
};

const THRESHOLD = 6;

/**
 * Returns a warning to show before recording a punch, or null if no warning
 * is needed. Compares now against the scheduled start (clock_in) or end
 * (clock_out) in the store's local timezone. With `at` (the current instant and
 * store timezone) the difference is real elapsed time, which stays correct when
 * the shift spans a DST change; otherwise it falls back to wall-clock minutes.
 */
export function getPunchWarning(
  punchType: PunchType,
  nowMinutes: number,
  schedule: Schedule | null,
  at?: { nowMs: number; tz: string }
): PunchWarning | null {
  if (!schedule) return null;

  const diffFrom = (scheduledMinutes: number) =>
    at && schedule.date
      ? minutesFromScheduled(at.nowMs, schedule.date.slice(0, 10), scheduledMinutes, at.tz)
      : nowMinutes - scheduledMinutes;

  if (punchType === "clock_in") {
    const diff = diffFrom(schedule.startMinutes);
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
    const diff = diffFrom(schedule.endMinutes);
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
  return fmtMinutes(minutes);
}
