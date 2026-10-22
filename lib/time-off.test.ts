import { describe, it, expect } from "vitest";
import {
  MAX_TIME_OFF_DAYS,
  collapseTimeOffGroups,
  describeTimeOff,
  expandTimeOffRequests,
  parseTimeOffRequest,
  requestDates,
  shiftsDuringTimeOff,
  timeOffOverlaps,
  timeOffWindow,
} from "./time-off";

const TODAY = "2026-10-18";

describe("parseTimeOffRequest", () => {
  it("accepts a single whole day", () => {
    expect(parseTimeOffRequest({ date: "2026-10-20" }, TODAY)).toEqual({
      request: { date: "2026-10-20", endDate: "2026-10-20", window: null },
      error: null,
    });
  });

  it("accepts several days", () => {
    const { request } = parseTimeOffRequest({ date: "2026-10-20", endDate: "2026-10-24" }, TODAY);
    expect(request).toEqual({ date: "2026-10-20", endDate: "2026-10-24", window: null });
  });

  it("accepts part of a day", () => {
    const { request } = parseTimeOffRequest({ date: "2026-10-20", startMinutes: 900, endMinutes: 1080 }, TODAY);
    expect(request?.window).toEqual({ startMinutes: 900, endMinutes: 1080 });
  });

  it("treats midnight-to-midnight as a whole day", () => {
    const { request } = parseTimeOffRequest({ date: "2026-10-20", startMinutes: 0, endMinutes: 1440 }, TODAY);
    expect(request?.window).toBeNull();
  });

  it.each([
    [{ date: "2026-10-17" }, /today or in the future/],
    [{ date: "20-10-2026" }, /YYYY-MM-DD/],
    [{ date: "2026-10-20", endDate: "2026-10-19" }, /must not be before/],
    [{ date: "2026-10-20", endDate: "nope" }, /endDate/],
    [{ date: "2026-10-20", endDate: "2026-12-31" }, new RegExp(`at most ${MAX_TIME_OFF_DAYS} days`)],
    [{ date: "2026-10-20", endDate: "2026-10-21", startMinutes: 900, endMinutes: 1080 }, /single day/],
    [{ date: "2026-10-20", startMinutes: 900 }, /both be whole minutes/],
    [{ date: "2026-10-20", startMinutes: 900.5, endMinutes: 1000 }, /both be whole minutes/],
    [{ date: "2026-10-20", startMinutes: 1080, endMinutes: 900 }, /end after it starts/],
    [{ date: "2026-10-20", startMinutes: 900, endMinutes: 905 }, /end after it starts/],
    [{ date: "2026-10-20", startMinutes: 900, endMinutes: 1500 }, /within the day/],
  ])("rejects %j", (body, message) => {
    const out = parseTimeOffRequest(body as Record<string, unknown>, TODAY);
    expect(out.request).toBeNull();
    expect(out.error).toMatch(message);
  });

  it("allows exactly the longest request", () => {
    expect(parseTimeOffRequest({ date: "2026-11-01", endDate: "2026-12-01" }, TODAY).error).toBeNull();
    expect(parseTimeOffRequest({ date: "2026-11-01", endDate: "2026-12-02" }, TODAY).error).not.toBeNull();
  });
});

describe("timeOffWindow / timeOffOverlaps", () => {
  it("reads a whole day as null, which overlaps everything", () => {
    expect(timeOffWindow({ start_minutes: null, end_minutes: null })).toBeNull();
    expect(timeOffOverlaps(null, 0, 60)).toBe(true);
  });

  it("only overlaps a part day where the times meet", () => {
    const w = timeOffWindow({ start_minutes: 900, end_minutes: 1080 });
    expect(timeOffOverlaps(w, 540, 900)).toBe(false); // ends as the time off starts
    expect(timeOffOverlaps(w, 540, 901)).toBe(true);
    expect(timeOffOverlaps(w, 1080, 1320)).toBe(false);
    expect(timeOffOverlaps(w, 1000, 1320)).toBe(true);
  });
});

describe("requestDates", () => {
  it("lists every day, across a month end", () => {
    expect(requestDates({ date: "2026-10-30", endDate: "2026-11-02" })).toEqual([
      "2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02",
    ]);
  });
});

describe("shiftsDuringTimeOff", () => {
  const s = (id: number, date: string, startMinutes: number, endMinutes: number) => ({ id, employeeId: 1, date, startMinutes, endMinutes });

  it("finds shifts on whole days off", () => {
    const shifts = [s(1, "2026-10-20", 540, 1020), s(2, "2026-10-22", 540, 1020)];
    expect(shiftsDuringTimeOff(shifts, [{ date: "2026-10-20", window: null }]).map((x) => x.id)).toEqual([1]);
  });

  it("only finds shifts that meet a part day", () => {
    const shifts = [s(1, "2026-10-20", 540, 900), s(2, "2026-10-20", 960, 1200)];
    const days = [{ date: "2026-10-20", window: { startMinutes: 900, endMinutes: 1080 } }];
    expect(shiftsDuringTimeOff(shifts, days).map((x) => x.id)).toEqual([2]);
  });

  it("counts an overnight shift from the day before", () => {
    const shifts = [s(1, "2026-10-19", 1320, 1800)]; // 10 PM – 6 AM into the 20th
    expect(shiftsDuringTimeOff(shifts, [{ date: "2026-10-20", window: null }]).map((x) => x.id)).toEqual([1]);
    // ...but not when the time off starts after the shift has ended.
    expect(shiftsDuringTimeOff(shifts, [{ date: "2026-10-20", window: { startMinutes: 480, endMinutes: 600 } }])).toEqual([]);
  });
});

describe("describeTimeOff", () => {
  it("names one day, a part day, and a range", () => {
    expect(describeTimeOff(["2026-10-20"], null)).toBe("Tue, Oct 20");
    expect(describeTimeOff(["2026-10-20"], { startMinutes: 900, endMinutes: 1080 })).toMatch(/^Tue, Oct 20, 3(:00)?\s?PM – 6(:00)?\s?PM$/);
    expect(describeTimeOff(["2026-10-24", "2026-10-20", "2026-10-22"], null)).toBe("Oct 20 – Oct 24");
    expect(describeTimeOff([], null)).toBe("");
  });
});

describe("collapseTimeOffGroups / expandTimeOffRequests", () => {
  const rows = [
    { id: 3, date: "2026-10-22", groupId: "g" },
    { id: 1, date: "2026-10-20", groupId: "g" },
    { id: 9, date: "2026-10-21", groupId: null },
    { id: 2, date: "2026-10-21", groupId: "g" },
  ];

  it("makes one entry per request, dated by its first day", () => {
    expect(collapseTimeOffGroups(rows)).toEqual([
      { id: 1, date: "2026-10-20", groupId: "g", endDate: "2026-10-22", days: 3 },
      { id: 9, date: "2026-10-21", groupId: null, endDate: "2026-10-21", days: 1 },
    ]);
  });

  it("expands back to one entry per day", () => {
    const days = expandTimeOffRequests(collapseTimeOffGroups(rows));
    expect(days.map((d) => d.date)).toEqual(["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-21"]);
  });
});
