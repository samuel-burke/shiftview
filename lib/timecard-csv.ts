// Serializes a computed Timecard to CSV for the manager-facing export.
//
// One row per punch, with a Flag/Detail column carrying the violation that
// punch triggered (late-in on the clock-in, long-break on the break-end, …).
// Call-outs and no-call-no-shows have no punch, so they appear as a synthetic
// row of that type stamped with the scheduled shift start (e.g. "NCNS … 9:00 AM").

import { fmtMinutes, type PunchType } from "@/data/types";
import type { Timecard } from "@/lib/timecard";

const PUNCH_LABELS: Record<PunchType, string> = {
  clock_in: "Clock In",
  clock_out: "Clock Out",
  break_start: "Break Start",
  break_end: "Break End",
};

function escapeCSV(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function fmtTime(iso: string, tz: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit",
  });
}

export function timecardToCsv(tc: Timecard): string {
  const headers = ["Date", "Day", "Type", "Time", "Flag", "Detail", "Manual", "Note"];
  const lines = [headers.join(",")];
  const push = (cells: unknown[]) => lines.push(cells.map(escapeCSV).join(","));

  for (const day of tc.days) {
    const startTime = day.schedule ? fmtMinutes(day.schedule.startMinutes) : "";

    // Day-level violations with no originating punch become their own row,
    // stamped with the scheduled start time.
    const callout = day.violations.find((v) => v.type === "callout");
    if (callout) push([day.date, day.dayName, "Call Out", startTime, callout.label, callout.detail, "", ""]);

    const ncns = day.violations.find((v) => v.type === "ncns");
    if (ncns) push([day.date, day.dayName, "NCNS", startTime, ncns.label, ncns.detail, "", ""]);

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
      ]);
    }
  }

  return lines.join("\n");
}
