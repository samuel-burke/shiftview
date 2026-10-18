// Serializes a computed Timecard to CSV for the manager-facing export.
//
// One row per punch, with a Flag/Detail column carrying the violation that
// punch triggered (late-in on the clock-in, long-break on the break-end, …).
// Call-outs and no-call-no-shows have no punch, so they appear as a synthetic
// row of that type stamped with the scheduled shift start (e.g. "NCNS … 9:00 AM").

import { fmtMinutes, type PunchType } from "@/data/types";
import type { Timecard } from "@/lib/timecard";
import { csvCell } from "@/lib/csv";

const PUNCH_LABELS: Record<PunchType, string> = {
  clock_in: "Clock In",
  clock_out: "Clock Out",
  break_start: "Break Start",
  break_end: "Break End",
};

function fmtTime(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit",
  });
}

const LEAVE_LABELS: Record<string, string> = { pto: "PTO", sick: "Sick" };

// `paidLeave`: approved PTO and sick days, one row each with its hours in the
// last column (paid, not worked).
export function timecardToCsv(
  tc: Timecard,
  paidLeave: { date: string; leaveType: string; hours: number }[] = [],
): string {
  const headers = ["Date", "Day", "Type", "Time", "Flag", "Detail", "Manual", "Note", "Paid Leave Hrs"];
  const lines = [headers.join(",")];
  const push = (cells: unknown[]) => lines.push(cells.map(csvCell).join(","));

  const leaveByDate = new Map<string, { leaveType: string; hours: number }[]>();
  for (const l of paidLeave) leaveByDate.set(l.date, [...(leaveByDate.get(l.date) ?? []), l]);
  const dayNames = new Map(tc.days.map((d) => [d.date, d.dayName]));
  const pushLeave = (date: string) => {
    for (const l of leaveByDate.get(date) ?? []) {
      const dayName = dayNames.get(date)
        ?? new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
      push([date, dayName, LEAVE_LABELS[l.leaveType] ?? l.leaveType, "", "", "", "", "", l.hours.toFixed(2)]);
    }
    leaveByDate.delete(date);
  };

  for (const day of tc.days) {
    // Leave days with no punches or schedule come in date order too.
    for (const date of [...leaveByDate.keys()].filter((d) => d < day.date).sort()) pushLeave(date);
    pushLeave(day.date);
    const startTime = day.schedule ? fmtMinutes(day.schedule.startMinutes) : "";

    // Day-level violations with no originating punch become their own row,
    // stamped with the scheduled start time.
    const callout = day.violations.find((v) => v.type === "callout");
    if (callout) push([day.date, day.dayName, "Call Out", startTime, callout.label, callout.detail, "", "", ""]);

    // One NCNS row per missed shift (a split-shift day can miss both).
    for (const ncns of day.violations.filter((v) => v.type === "ncns")) {
      const missedAt = ncns.scheduledMinutes != null ? fmtMinutes(ncns.scheduledMinutes) : startTime;
      push([day.date, day.dayName, "NCNS", missedAt, ncns.label, ncns.detail, "", "", ""]);
    }

    // One row per punch, flagged with the violation it triggered (if any).
    for (const p of day.punches) {
      const v = day.violations.find((x) => x.punchId === p.id);
      push([
        day.date,
        day.dayName,
        PUNCH_LABELS[p.punchType],
        fmtTime(p.punchedAt, tc.timezone),
        v?.label ?? "",
        v?.detail ?? "",
        p.isManual ? "yes" : "no",
        p.note ?? "",
        "",
      ]);
    }
  }

  for (const date of [...leaveByDate.keys()].sort()) pushLeave(date);

  return lines.join("\n");
}
