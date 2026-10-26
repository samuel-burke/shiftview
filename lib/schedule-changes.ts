// What publishing a week changed for one person, in words for their
// notification: new shifts, changed times, and removed shifts, by day.

import { fmtMinutes } from "@/data/types";

export type ShiftTimes = { date: string; startMinutes: number; endMinutes: number; note?: string | null };
export type ScheduleChange =
  | { kind: "added"; shift: ShiftTimes }
  | { kind: "changed"; before: ShiftTimes; after: ShiftTimes }
  | { kind: "removed"; shift: ShiftTimes };

const day = (date: string) =>
  new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
const times = (s: ShiftTimes) => `${fmtMinutes(s.startMinutes)} – ${fmtMinutes(s.endMinutes)}`;

/** Whether a change actually changes anything the person sees. */
export function isRealChange(before: ShiftTimes, after: ShiftTimes): boolean {
  return before.startMinutes !== after.startMinutes || before.endMinutes !== after.endMinutes || (before.note ?? null) !== (after.note ?? null);
}

export function describeChange(c: ScheduleChange): string {
  switch (c.kind) {
    case "added":
      return `${day(c.shift.date)}: new shift ${times(c.shift)}`;
    case "removed":
      return `${day(c.shift.date)}: shift ${times(c.shift)} removed`;
    case "changed":
      return c.before.startMinutes === c.after.startMinutes && c.before.endMinutes === c.after.endMinutes
        ? `${day(c.after.date)}: note updated`
        : `${day(c.after.date)}: ${times(c.before)} → ${times(c.after)}`;
  }
}

const MAX_LINES = 4;

/**
 * The notification for one person: "Schedule Published" when the week is new
 * to them (only added shifts, none live before), "Schedule Updated" with the
 * changes otherwise.
 */
export function summarizeChanges(
  weekStart: string,
  changes: ScheduleChange[],
  hadLiveShifts: boolean
): { title: string; body: string } | null {
  if (changes.length === 0) return null;
  const sorted = [...changes].sort((a, b) => dateOf(a).localeCompare(dateOf(b)));
  if (!hadLiveShifts && sorted.every((c) => c.kind === "added")) {
    return { title: "Schedule Published", body: `Your schedule for the week of ${weekStart} has been published` };
  }
  const lines = sorted.slice(0, MAX_LINES).map(describeChange);
  if (sorted.length > MAX_LINES) lines.push(`and ${sorted.length - MAX_LINES} more`);
  return { title: "Schedule Updated", body: `Changes to your week of ${weekStart}: ${lines.join("; ")}` };
}

function dateOf(c: ScheduleChange): string {
  return (c.kind === "changed" ? c.after.date : c.shift.date).slice(0, 10);
}
