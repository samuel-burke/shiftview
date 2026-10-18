import { describe, it, expect } from "vitest";
import {
  ALERT_LOOKBACK_MS,
  findMissedClockOuts,
  findNoShows,
  isApproachingOvertime,
  projectWeeklyHours,
} from "./attendance-alerts";
import { DEFAULT_PUNCH_POLICY } from "./punch-policy";
import { zonedTimeToUtc } from "./dates";
import type { TimecardPunchInput } from "./timecard";

const NY = "America/New_York";
const policy = DEFAULT_PUNCH_POLICY; // NCNS on, 60 minutes

// The instant a store clock in `tz` reads hh:mm on `date`.
function at(date: string, hhmm: string, tz = NY): number {
  const [h, m] = hhmm.split(":").map(Number);
  return zonedTimeToUtc(date, h * 60 + m, tz).getTime();
}
const iso = (ms: number) => new Date(ms).toISOString();

let nextId = 1;
function punch(punchType: TimecardPunchInput["punchType"], ms: number): TimecardPunchInput {
  return { id: nextId++, punchType, punchedAt: iso(ms) };
}
function shift(date: string, start: string, end: string) {
  const toMin = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
  return { date, startMinutes: toMin(start), endMinutes: toMin(end) };
}

describe("findNoShows", () => {
  // 2026-03-02 is a Monday, EST.
  const schedules = [shift("2026-03-02", "09:00", "17:00")];

  it("flags a shift once the NCNS window past its start has passed", () => {
    const base = { timezone: NY, policy, schedules, punches: [], callouts: [] };
    expect(findNoShows({ ...base, nowMs: at("2026-03-02", "09:59") })).toEqual([]);
    const out = findNoShows({ ...base, nowMs: at("2026-03-02", "10:01") });
    expect(out).toEqual([{ date: "2026-03-02", startMinutes: 540, startMs: at("2026-03-02", "09:00") }]);
  });

  it("skips a shift the employee clocked in for, even late", () => {
    const punches = [punch("clock_in", at("2026-03-02", "09:30"))];
    expect(findNoShows({ timezone: NY, policy, schedules, punches, callouts: [], nowMs: at("2026-03-02", "11:00") })).toEqual([]);
  });

  it("skips a called-out shift, and every shift when NCNS is off", () => {
    const nowMs = at("2026-03-02", "11:00");
    expect(findNoShows({ timezone: NY, policy, schedules, punches: [], callouts: [{ date: "2026-03-02" }], nowMs })).toEqual([]);
    expect(findNoShows({ timezone: NY, policy: { ...policy, ncnsEnabled: false }, schedules, punches: [], callouts: [], nowMs })).toEqual([]);
  });

  it("uses the org's NCNS minutes", () => {
    const base = { timezone: NY, policy: { ...policy, ncnsMinutes: 15 }, schedules, punches: [], callouts: [] };
    expect(findNoShows({ ...base, nowMs: at("2026-03-02", "09:16") })).toHaveLength(1);
  });

  it("matches a clock-in just before midnight to a midnight shift", () => {
    const sched = [shift("2026-03-03", "00:00", "08:00")];
    const punches = [punch("clock_in", at("2026-03-02", "23:50"))];
    expect(findNoShows({ timezone: NY, policy, schedules: sched, punches, callouts: [], nowMs: at("2026-03-03", "02:00") })).toEqual([]);
  });

  it("flags yesterday's overnight shift after midnight", () => {
    const sched = [shift("2026-03-02", "23:00", "31:00")];
    const out = findNoShows({ timezone: NY, policy, schedules: sched, punches: [], callouts: [], nowMs: at("2026-03-03", "00:30") });
    expect(out.map((n) => n.date)).toEqual(["2026-03-02"]);
  });

  it("judges a shift on a DST spring-forward day by real time", () => {
    // 2026-03-08: 9:00 AM EDT is 13:00Z; an hour later is 14:00Z.
    const sched = [shift("2026-03-08", "09:00", "17:00")];
    const base = { timezone: NY, policy, schedules: sched, punches: [], callouts: [] };
    expect(findNoShows({ ...base, nowMs: Date.parse("2026-03-08T13:59:00Z") })).toEqual([]);
    expect(findNoShows({ ...base, nowMs: Date.parse("2026-03-08T14:01:00Z") })).toHaveLength(1);
  });

  it("ignores no-shows that came due before the lookback window", () => {
    const nowMs = at("2026-03-02", "10:00") + ALERT_LOOKBACK_MS + 60_000;
    expect(findNoShows({ timezone: NY, policy, schedules, punches: [], callouts: [], nowMs })).toEqual([]);
  });
});

describe("findMissedClockOuts", () => {
  it("flags a scheduled shift left open 2 hours past its end", () => {
    const schedules = [shift("2026-03-02", "09:00", "17:00")];
    const clockIn = punch("clock_in", at("2026-03-02", "08:55"));
    const base = { timezone: NY, schedules, punches: [clockIn] };
    expect(findMissedClockOuts({ ...base, nowMs: at("2026-03-02", "18:59") })).toEqual([]);
    expect(findMissedClockOuts({ ...base, nowMs: at("2026-03-02", "19:01") })).toEqual([{
      clockInId: clockIn.id,
      clockInMs: at("2026-03-02", "08:55"),
      deadlineMs: at("2026-03-02", "19:00"),
      shift: { date: "2026-03-02", startMinutes: 540, endMinutes: 1020 },
    }]);
  });

  it("ignores a shift that was clocked out, breaks included", () => {
    const punches = [
      punch("clock_in", at("2026-03-02", "09:00")),
      punch("break_start", at("2026-03-02", "12:00")),
      punch("break_end", at("2026-03-02", "12:30")),
      punch("clock_out", at("2026-03-02", "17:00")),
    ];
    expect(findMissedClockOuts({ timezone: NY, schedules: [shift("2026-03-02", "09:00", "17:00")], punches, nowMs: at("2026-03-02", "22:00") })).toEqual([]);
  });

  it("gives an unscheduled shift 16 hours", () => {
    const base = { timezone: NY, schedules: [], punches: [punch("clock_in", at("2026-03-02", "08:00"))] };
    expect(findMissedClockOuts({ ...base, nowMs: at("2026-03-02", "23:59") })).toEqual([]);
    const out = findMissedClockOuts({ ...base, nowMs: at("2026-03-03", "00:01") });
    expect(out).toHaveLength(1);
    expect(out[0].shift).toBeNull();
  });

  it("treats a clock-in after the shift ended as unscheduled", () => {
    const base = { timezone: NY, schedules: [shift("2026-03-02", "09:00", "17:00")], punches: [punch("clock_in", at("2026-03-02", "18:00"))] };
    expect(findMissedClockOuts({ ...base, nowMs: at("2026-03-02", "20:00") })).toEqual([]);
  });

  it("waits for an overnight shift's end on the next day", () => {
    const base = { timezone: NY, schedules: [shift("2026-03-02", "22:00", "30:00")], punches: [punch("clock_in", at("2026-03-02", "21:55"))] };
    expect(findMissedClockOuts({ ...base, nowMs: at("2026-03-03", "07:59") })).toEqual([]);
    expect(findMissedClockOuts({ ...base, nowMs: at("2026-03-03", "08:01") })).toHaveLength(1);
  });

  it("measures a shift across the fall-back night in real hours", () => {
    // 2026-11-01: midnight to 8 AM runs 9 real hours, so the shift ends at
    // 13:00Z and the clock-out is overdue at 15:00Z.
    const base = { timezone: NY, schedules: [shift("2026-11-01", "00:00", "08:00")], punches: [punch("clock_in", Date.parse("2026-11-01T04:00:00Z"))] };
    expect(findMissedClockOuts({ ...base, nowMs: Date.parse("2026-11-01T14:59:00Z") })).toEqual([]);
    expect(findMissedClockOuts({ ...base, nowMs: Date.parse("2026-11-01T15:01:00Z") })).toHaveLength(1);
  });

  it("ignores open shifts overdue since before the lookback window", () => {
    const base = { timezone: NY, schedules: [shift("2026-03-02", "09:00", "17:00")], punches: [punch("clock_in", at("2026-03-02", "09:00"))] };
    expect(findMissedClockOuts({ ...base, nowMs: at("2026-03-02", "19:00") + ALERT_LOOKBACK_MS + 60_000 })).toEqual([]);
  });
});

describe("projectWeeklyHours", () => {
  // Monday–Thursday, 8 hours each, clocked in and out: 32 hours.
  const worked = ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"].flatMap((d) => [
    punch("clock_in", at(d, "09:00")),
    punch("clock_out", at(d, "17:00")),
  ]);
  const workedShifts = ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"].map((d) => shift(d, "09:00", "17:00"));
  const fridayNight = at("2026-03-05", "20:00");

  it("adds worked and remaining scheduled hours", () => {
    const p = projectWeeklyHours({
      timezone: NY, nowMs: fridayNight, punches: worked, callouts: [],
      schedules: [...workedShifts, shift("2026-03-06", "08:00", "17:00")],
    });
    expect(p).toEqual({ weekStart: "2026-03-02", workedHours: 32, remainingScheduledHours: 9, projectedHours: 41 });
    expect(isApproachingOvertime(p)).toBe(true);
  });

  it("does not warn at exactly 40 projected hours", () => {
    const p = projectWeeklyHours({
      timezone: NY, nowMs: fridayNight, punches: worked, callouts: [],
      schedules: [...workedShifts, shift("2026-03-06", "09:00", "17:00")],
    });
    expect(p.projectedHours).toBe(40);
    expect(isApproachingOvertime(p)).toBe(false);
  });

  it("drops a called-out shift from what's still scheduled", () => {
    const p = projectWeeklyHours({
      timezone: NY, nowMs: fridayNight, punches: worked, callouts: [{ date: "2026-03-06" }],
      schedules: [...workedShifts, shift("2026-03-06", "08:00", "17:00")],
    });
    expect(p.remainingScheduledHours).toBe(0);
  });

  it("counts the shift under way up to now, and only its unworked rest as remaining", () => {
    const p = projectWeeklyHours({
      timezone: NY, nowMs: at("2026-03-06", "13:00"), callouts: [],
      punches: [...worked, punch("clock_in", at("2026-03-06", "08:00"))],
      schedules: [...workedShifts, shift("2026-03-06", "08:00", "17:00")],
    });
    expect(p).toMatchObject({ workedHours: 37, remainingScheduledHours: 4, projectedHours: 41 });
  });

  it("warns past 36 worked hours with nothing more scheduled", () => {
    const p = projectWeeklyHours({
      timezone: NY, nowMs: at("2026-03-06", "20:00"), callouts: [], schedules: [],
      punches: [...worked, punch("clock_in", at("2026-03-06", "09:00")), punch("clock_out", at("2026-03-06", "13:30"))],
    });
    expect(p.workedHours).toBe(36.5);
    expect(isApproachingOvertime(p)).toBe(true);
  });

  it("ignores a shift that ended early once clocked out", () => {
    const p = projectWeeklyHours({
      timezone: NY, nowMs: at("2026-03-02", "16:00"), callouts: [],
      punches: [punch("clock_in", at("2026-03-02", "09:00")), punch("clock_out", at("2026-03-02", "15:00"))],
      schedules: [shift("2026-03-02", "09:00", "17:00")],
    });
    expect(p).toMatchObject({ workedHours: 6, remainingScheduledHours: 0 });
  });

  it("starts the workweek on the store's Monday, far east of UTC", () => {
    const KIRI = "Pacific/Kiritimati"; // UTC+14
    const p = projectWeeklyHours({
      timezone: KIRI, nowMs: at("2026-03-02", "10:00", KIRI), callouts: [], schedules: [],
      punches: [
        // Sunday's shift belongs to the week before.
        punch("clock_in", at("2026-03-01", "09:00", KIRI)), punch("clock_out", at("2026-03-01", "17:00", KIRI)),
        punch("clock_in", at("2026-03-02", "06:00", KIRI)), punch("clock_out", at("2026-03-02", "09:00", KIRI)),
      ],
    });
    expect(p).toMatchObject({ weekStart: "2026-03-02", workedHours: 3 });
  });

  it("counts a fall-back overnight shift's real hours", () => {
    // Sunday 2026-11-01, midnight to 8 AM: 9 real hours still to come.
    const p = projectWeeklyHours({
      timezone: NY, nowMs: Date.parse("2026-11-01T03:00:00Z"), callouts: [], punches: [],
      schedules: [shift("2026-11-01", "00:00", "08:00")],
    });
    expect(p.remainingScheduledHours).toBe(9);
  });
});
