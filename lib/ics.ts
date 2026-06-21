// Minimal RFC 5545 (iCalendar) generation for exporting an employee's shifts to
// their personal calendar. Pure and dependency-free so it can be unit-tested and
// run in a route handler.
//
// Shift times are stored as minutes since midnight on a plain date, with no
// timezone (the domain is single-store, no overnight shifts — see BR-4). We emit
// them as *floating* local times (no Z, no TZID): a calendar shows the event at
// that wall-clock time in the viewer's own timezone, which is exactly what "your
// 8:00 AM shift" should mean, and sidesteps VTIMEZONE/DST complexity.

const PRODID = "-//ShiftView//Shift Schedule//EN";

export function escapeICSText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// A UTC timestamp in ICS basic format, e.g. 20260706T133000Z. Used for DTSTAMP.
export function formatUTCStamp(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

// A floating local date-time (no Z) from a YYYY-MM-DD date and minutes since
// midnight, e.g. ("2026-07-06", 480) → 20260706T080000.
export function formatFloatingLocal(date: string, minutes: number): string {
  const compact = date.slice(0, 10).replace(/-/g, "");
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${compact}T${pad(h)}${pad(m)}00`;
}

// Fold a content line to the 75-octet limit (RFC 5545 §3.1): continuation lines
// begin with a single space. We fold on character count, which is correct for
// the ASCII content we emit.
export function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 74) {
    parts.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  parts.push(" " + rest);
  return parts.join("\r\n");
}

export type ShiftEvent = {
  uid: string;
  date: string; // YYYY-MM-DD
  startMinutes: number;
  endMinutes: number;
  summary: string;
  description?: string;
  location?: string;
};

// Build a complete VCALENDAR document from a list of shifts.
export function buildShiftCalendar(
  events: ShiftEvent[],
  opts: { calendarName: string; dtstamp?: Date }
): string {
  const dtstamp = formatUTCStamp(opts.dtstamp ?? new Date());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    foldLine(`X-WR-CALNAME:${escapeICSText(opts.calendarName)}`),
  ];

  for (const e of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${e.uid}`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART:${formatFloatingLocal(e.date, e.startMinutes)}`);
    lines.push(`DTEND:${formatFloatingLocal(e.date, e.endMinutes)}`);
    lines.push(foldLine(`SUMMARY:${escapeICSText(e.summary)}`));
    if (e.description) lines.push(foldLine(`DESCRIPTION:${escapeICSText(e.description)}`));
    if (e.location) lines.push(foldLine(`LOCATION:${escapeICSText(e.location)}`));
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
