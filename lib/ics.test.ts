import { describe, it, expect } from "vitest";
import {
  escapeICSText,
  formatUTCStamp,
  formatFloatingLocal,
  foldLine,
  buildShiftCalendar,
  type ShiftEvent,
} from "./ics";

describe("escapeICSText", () => {
  it("escapes backslashes, commas, semicolons, and newlines", () => {
    expect(escapeICSText("a,b;c\\d")).toBe("a\\,b\\;c\\\\d");
    expect(escapeICSText("line1\nline2")).toBe("line1\\nline2");
  });
});

describe("formatUTCStamp", () => {
  it("formats a Date as a UTC ICS timestamp", () => {
    expect(formatUTCStamp(new Date("2026-07-06T13:30:00Z"))).toBe("20260706T133000Z");
  });
});

describe("formatFloatingLocal", () => {
  it("formats a date + minutes-since-midnight as a floating local time", () => {
    expect(formatFloatingLocal("2026-07-06", 480)).toBe("20260706T080000");
    expect(formatFloatingLocal("2026-07-06", 1020)).toBe("20260706T170000");
    expect(formatFloatingLocal("2026-07-06", 0)).toBe("20260706T000000");
  });

  it("handles non-zero minutes", () => {
    expect(formatFloatingLocal("2026-12-31", 545)).toBe("20261231T090500");
  });
});

describe("foldLine", () => {
  it("leaves short lines untouched", () => {
    expect(foldLine("SUMMARY:Short")).toBe("SUMMARY:Short");
  });

  it("folds lines longer than 75 octets with CRLF + space", () => {
    const long = "DESCRIPTION:" + "x".repeat(200);
    const folded = foldLine(long);
    expect(folded).toContain("\r\n ");
    for (const seg of folded.split("\r\n")) {
      // Each physical line (accounting for the leading space on continuations)
      // stays within the 75-octet limit.
      expect(seg.length).toBeLessThanOrEqual(75);
    }
  });
});

describe("buildShiftCalendar", () => {
  const events: ShiftEvent[] = [
    {
      uid: "shift-1@shiftview",
      date: "2026-07-06",
      startMinutes: 480,
      endMinutes: 1020,
      summary: "Shift: Opener",
      location: "Main Store",
    },
  ];
  const ics = buildShiftCalendar(events, {
    calendarName: "My Shifts",
    dtstamp: new Date("2026-07-01T00:00:00Z"),
  });

  it("wraps events in a VCALENDAR with required headers", () => {
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("PRODID:");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("emits a VEVENT with floating start/end, summary, uid, and dtstamp", () => {
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:shift-1@shiftview");
    expect(ics).toContain("DTSTART:20260706T080000");
    expect(ics).toContain("DTEND:20260706T170000");
    expect(ics).toContain("SUMMARY:Shift: Opener");
    expect(ics).toContain("LOCATION:Main Store");
    expect(ics).toContain("DTSTAMP:20260701T000000Z");
    expect(ics).toContain("END:VEVENT");
  });

  it("uses CRLF line endings", () => {
    expect(ics).toContain("\r\n");
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  });

  it("escapes special characters in text fields", () => {
    const out = buildShiftCalendar(
      [{ uid: "x", date: "2026-07-06", startMinutes: 480, endMinutes: 960, summary: "A, B; C" }],
      { calendarName: "Cal" }
    );
    expect(out).toContain("SUMMARY:A\\, B\\; C");
  });

  it("produces one VEVENT per shift", () => {
    const out = buildShiftCalendar(
      [
        { uid: "a", date: "2026-07-06", startMinutes: 480, endMinutes: 960, summary: "S1" },
        { uid: "b", date: "2026-07-07", startMinutes: 540, endMinutes: 1020, summary: "S2" },
      ],
      { calendarName: "Cal" }
    );
    expect(out.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });
});
