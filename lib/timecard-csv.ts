// Serializes a computed Timecard to CSV for the manager-facing export.
//
// One row per punch, with a Flag/Detail column carrying the violation that
// punch triggered (late-in on the clock-in, long-break on the break-end, …).
// Call-outs and no-call-no-shows have no punch, so they appear as a synthetic
// row of that type stamped with the scheduled shift start (e.g. "NCNS … 9:00 AM").
// With punch rounding on, a "Rounded Time" column follows the real time: the
// time payroll pays the punch at (blank when rounding leaves it unchanged).

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

export function timecardToCsv(tc: Timecard): string {
  const rounded = !!tc.roundingMinutes;
  const headers = ["Date", "Day", "Type", "Time", ...(rounded ? ["Rounded Time"] : []), "Flag", "Detail", "Manual", "Note"];
  const lines = [headers.join(",")];
  // Cells after Time; the rounded column (when on) is inserted after Time.
  const push = (cells: unknown[], roundedTime = "") => {
    const row = rounded ? [...cells.slice(0, 4), roundedTime, ...cells.slice(4)] : cells;
    lines.push(row.map(csvCell).join(","));
  };

  for (const day of tc.days) {
    const startTime = day.schedule ? fmtMinutes(day.schedule.startMinutes) : "";

    // Day-level violations with no originating punch become their own row,
    // stamped with the scheduled start time.
    const callout = day.violations.find((v) => v.type === "callout");
    if (callout) push([day.date, day.dayName, "Call Out", startTime, callout.label, callout.detail, "", ""]);

    // One NCNS row per missed shift (a split-shift day can miss both).
    for (const ncns of day.violations.filter((v) => v.type === "ncns")) {
      const missedAt = ncns.scheduledMinutes != null ? fmtMinutes(ncns.scheduledMinutes) : startTime;
      push([day.date, day.dayName, "NCNS", missedAt, ncns.label, ncns.detail, "", ""]);
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
      ], p.roundedAt ? fmtTime(p.roundedAt, tc.timezone) : "");
    }
  }

  return lines.join("\n");
}
