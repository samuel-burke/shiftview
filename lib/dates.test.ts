import { afterEach, describe, expect, it } from "vitest";
import {
  addDaysToKey,
  allTimezones,
  dateFromKey,
  dateForWeekday,
  dateKeyInTz,
  dayOfWeekForKey,
  daysBetweenKeys,
  eachDateKey,
  formatDateKey,
  getLocalMinutes,
  isDateKey,
  isValidTimezone,
  localDateKey,
  localDayBoundsUtc,
  minutesFromScheduled,
  parseHHMM,
  previousPayWeek,
  resolveTimezone,
  shiftElapsedMinutes,
  storeToday,
  todayKeyInTz,
  utcOffsetLabel,
  weekStartForKey,
  zonedTimeToUtc,
} from "./dates";

// Store timezones covering every awkward case: both extremes of the UTC range,
// half- and quarter-hour offsets, southern-hemisphere DST, a 30-minute DST
// shift (Lord Howe), DST changes at midnight (Santiago, Havana), and zones
// without DST.
const STORE_ZONES = [
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "America/St_Johns",       // −03:30 / −02:30
  "America/Santiago",       // DST changes at midnight
  "America/Havana",         // DST changes at midnight
  "America/Sao_Paulo",      // no DST since 2019
  "Europe/London",
  "Europe/Berlin",
  "Africa/Cairo",
  "Asia/Kolkata",           // +05:30
  "Asia/Kathmandu",         // +05:45
  "Asia/Tokyo",
  "Australia/Sydney",       // southern-hemisphere DST
  "Australia/Lord_Howe",    // 30-minute DST shift
  "Pacific/Chatham",        // +12:45 / +13:45
  "Pacific/Kiritimati",     // +14
  "Pacific/Pago_Pago",      // −11
  "Pacific/Honolulu",
];

// Runtime (server / browser) zones the pure helpers must be independent of.
const RUNTIME_ZONES = ["UTC", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Asia/Kathmandu", "America/Santiago", "Australia/Lord_Howe"];

const ORIGINAL_TZ = process.env.TZ;
function withRuntimeTz<T>(tz: string, fn: () => T): T {
  process.env.TZ = tz;
  try {
    return fn();
  } finally {
    process.env.TZ = ORIGINAL_TZ;
  }
}
afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

const HOUR = 3_600_000;

describe("date-key arithmetic", () => {
  it("validates real calendar dates only", () => {
    expect(isDateKey("2028-02-29")).toBe(true);
    expect(isDateKey("2027-02-29")).toBe(false);
    expect(isDateKey("2026-04-31")).toBe(false);
    expect(isDateKey("2026-13-01")).toBe(false);
    expect(isDateKey("2026-1-01")).toBe(false);
    expect(isDateKey(20260101)).toBe(false);
  });

  it("adds days across month, year, leap-day and DST boundaries", () => {
    expect(addDaysToKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToKey("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDaysToKey("2027-02-28", 1)).toBe("2027-03-01");
    expect(addDaysToKey("2026-03-08", 1)).toBe("2026-03-09"); // US spring forward
    expect(addDaysToKey("2026-11-01", -1)).toBe("2026-10-31"); // US fall back
    expect(addDaysToKey("2026-01-15", -365)).toBe("2025-01-15");
  });

  it("computes weekdays, day spans and week starts", () => {
    expect(dayOfWeekForKey("2026-10-05")).toBe(1); // Monday
    expect(daysBetweenKeys("2026-03-01", "2026-03-31")).toBe(30);
    expect(daysBetweenKeys("2026-11-02", "2026-10-31")).toBe(-2);
    expect(weekStartForKey("2026-10-07", 1)).toBe("2026-10-05"); // Wed → Mon
    expect(weekStartForKey("2026-10-04", 1)).toBe("2026-09-28"); // Sun → previous Mon
    expect(weekStartForKey("2026-10-07", 6)).toBe("2026-10-03"); // Saturday-start weeks
    expect(weekStartForKey("2026-10-03", 6)).toBe("2026-10-03");
    expect(eachDateKey("2026-02-27", "2026-03-02")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
  });

  it("defaults payroll to the previous full Monday–Sunday week, whatever today is", () => {
    for (const today of ["2026-10-05", "2026-10-07", "2026-10-10", "2026-10-11"]) {
      expect(previousPayWeek(today)).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    }
    expect(previousPayWeek("2026-10-04")).toEqual({ from: "2026-09-21", to: "2026-09-27" });
  });

  it("formats date keys without any runtime zone shifting them", () => {
    for (const rt of RUNTIME_ZONES) {
      withRuntimeTz(rt, () => {
        expect(formatDateKey("2026-01-02", { weekday: "long", month: "long", day: "numeric" })).toBe("Friday, January 2");
      });
    }
  });

  it("is independent of the runtime timezone", () => {
    const results = RUNTIME_ZONES.map((rt) =>
      withRuntimeTz(rt, () => [
        addDaysToKey("2026-03-08", 1),
        dayOfWeekForKey("2026-11-01"),
        weekStartForKey("2026-09-06", 0),
        daysBetweenKeys("2026-03-01", "2026-04-01"),
      ])
    );
    for (const r of results) expect(r).toEqual(results[0]);
  });
});

describe("instants ↔ store wall clock", () => {
  it("never reports midnight as minute 1440", () => {
    // 00:30 in New York — some engines format hour12:false midnight as "24".
    expect(getLocalMinutes("2026-10-05T04:30:00Z", "America/New_York")).toBe(30);
    expect(getLocalMinutes("2026-10-05T04:00:00Z", "America/New_York")).toBe(0);
  });

  it("finds the store's calendar date for an instant at both ends of the UTC range", () => {
    const instant = "2026-10-05T10:30:00Z";
    expect(dateKeyInTz(instant, "Pacific/Kiritimati")).toBe("2026-10-06"); // +14
    expect(dateKeyInTz(instant, "Pacific/Pago_Pago")).toBe("2026-10-04"); // −11
    expect(dateKeyInTz(instant, "Asia/Kathmandu")).toBe("2026-10-05");
    expect(getLocalMinutes(instant, "Asia/Kathmandu")).toBe(16 * 60 + 15); // +05:45
    expect(getLocalMinutes(instant, "America/St_Johns")).toBe(8 * 60); // −02:30 (DST)
  });

  it("computes 'today' in the store's zone, not UTC's or the runtime's", () => {
    // 01:00 UTC on Oct 6 is still the evening of Oct 5 in the Americas.
    const now = Date.parse("2026-10-06T01:00:00Z");
    for (const rt of RUNTIME_ZONES) {
      withRuntimeTz(rt, () => {
        expect(todayKeyInTz("America/New_York", now)).toBe("2026-10-05");
        expect(todayKeyInTz("America/Los_Angeles", now)).toBe("2026-10-05");
        expect(todayKeyInTz("Asia/Tokyo", now)).toBe("2026-10-06");
        expect(todayKeyInTz("UTC", now)).toBe("2026-10-06");
      });
    }
  });

  it("round-trips wall times all year — every quarter hour on DST-change days", () => {
    let gaps = 0;
    for (const tz of STORE_ZONES) {
      for (let key = "2026-01-01"; key <= "2026-12-31"; key = addDaysToKey(key, 1)) {
        const { start, end } = localDayBoundsUtc(key, tz);
        const isChangeDay = end.getTime() + 1 - start.getTime() !== 24 * HOUR;
        const minutes = isChangeDay
          ? Array.from({ length: 96 }, (_, i) => i * 15)
          : [0, 375, 750, 1435];
        for (const m of minutes) {
          const t = zonedTimeToUtc(key, m, tz);
          const roundTrips = dateKeyInTz(t, tz) === key && getLocalMinutes(t, tz) === m;
          if (!roundTrips) {
            // Only a wall time skipped by spring-forward may fail to round-trip:
            // it resolves forward by the size of the gap (at most an hour) and
            // stays within the same local day.
            expect(isChangeDay).toBe(true);
            expect(t.getTime()).toBeGreaterThanOrEqual(start.getTime());
            expect(t.getTime()).toBeLessThanOrEqual(end.getTime());
            expect(dateKeyInTz(t, tz)).toBe(key);
            const shifted = getLocalMinutes(t, tz) - m;
            expect(shifted).toBeGreaterThan(0);
            expect(shifted).toBeLessThanOrEqual(60);
            gaps++;
          }
        }
      }
    }
    // Spring-forward gaps exist but are rare (a few per DST zone per year).
    expect(gaps).toBeGreaterThan(0);
    expect(gaps).toBeLessThan(STORE_ZONES.length * 8);
  }, 60_000);

  it("gives every local day exact bounds: 23–25 hours, contiguous, all year", () => {
    for (const tz of STORE_ZONES) {
      for (let key = "2026-01-01"; key <= "2026-12-31"; key = addDaysToKey(key, 1)) {
        const { start, end } = localDayBoundsUtc(key, tz);
        expect(dateKeyInTz(start, tz)).toBe(key);
        expect(dateKeyInTz(end, tz)).toBe(key);
        expect(dateKeyInTz(start.getTime() - 1, tz)).toBe(addDaysToKey(key, -1));
        expect(dateKeyInTz(end.getTime() + 1, tz)).toBe(addDaysToKey(key, 1));
        const hours = (end.getTime() + 1 - start.getTime()) / HOUR;
        expect(hours).toBeGreaterThanOrEqual(23);
        expect(hours).toBeLessThanOrEqual(25);
        // The next day starts the instant this one ends.
        expect(localDayBoundsUtc(addDaysToKey(key, 1), tz).start.getTime()).toBe(end.getTime() + 1);
      }
    }
  }, 60_000);

  it("puts the US fall-back and spring-forward day boundaries at the real midnight", () => {
    // Fall back (25h day): midnight is still EDT. The old noon-offset math put
    // the start at 05:00Z, so a 12:30 AM clock-in landed on the previous day.
    const fallBack = localDayBoundsUtc("2026-11-01", "America/New_York");
    expect(fallBack.start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(fallBack.end.toISOString()).toBe("2026-11-02T04:59:59.999Z");
    // Spring forward (23h day): midnight is still EST.
    const springForward = localDayBoundsUtc("2026-03-08", "America/New_York");
    expect(springForward.start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(springForward.end.toISOString()).toBe("2026-03-09T03:59:59.999Z");
  });

  it("starts a day whose midnight is skipped at the transition instant (Santiago)", () => {
    // Chile springs forward at 24:00 Saturday → 01:00 Sunday 2026-09-06.
    const { start } = localDayBoundsUtc("2026-09-06", "America/Santiago");
    expect(start.toISOString()).toBe("2026-09-06T04:00:00.000Z");
    expect(getLocalMinutes(start, "America/Santiago")).toBe(60);
  });

  it("resolves ambiguous fall-back times to the first occurrence and skipped times forward", () => {
    // 01:30 happens twice in New York on 2026-11-01.
    expect(zonedTimeToUtc("2026-11-01", 90, "America/New_York").toISOString()).toBe("2026-11-01T05:30:00.000Z");
    // 02:30 doesn't exist on 2026-03-08; it resolves to 03:30 EDT.
    expect(zonedTimeToUtc("2026-03-08", 150, "America/New_York").toISOString()).toBe("2026-03-08T07:30:00.000Z");
    // Lord Howe only shifts by 30 minutes: a skipped 02:15 moves to 02:45.
    expect(zonedTimeToUtc("2026-10-04", 135, "Australia/Lord_Howe").toISOString()).toBe(
      zonedTimeToUtc("2026-10-04", 165, "Australia/Lord_Howe").toISOString()
    );
    // Chatham (+13:45): wall times next to the change still resolve exactly —
    // the offset is too large for a ±12h search window to see the change.
    expect(zonedTimeToUtc("2026-04-05", 120, "Pacific/Chatham").toISOString()).toBe("2026-04-04T12:15:00.000Z");
    expect(zonedTimeToUtc("2026-09-27", 120, "Pacific/Chatham").toISOString()).toBe("2026-09-26T13:15:00.000Z");
  });

  it("is independent of the runtime timezone", () => {
    const snapshot = () => [
      zonedTimeToUtc("2026-11-01", 90, "America/New_York").toISOString(),
      localDayBoundsUtc("2026-03-08", "America/New_York").start.toISOString(),
      dateKeyInTz("2026-10-05T10:30:00Z", "Pacific/Kiritimati"),
      getLocalMinutes("2026-10-05T10:30:00Z", "Asia/Kathmandu"),
      shiftElapsedMinutes("2026-04-05", 0, 480, "Australia/Sydney"),
    ];
    const expected = snapshot();
    for (const rt of RUNTIME_ZONES) expect(withRuntimeTz(rt, snapshot)).toEqual(expected);
  });
});

describe("DST-aware durations and lateness", () => {
  it("measures shifts across DST changes in real elapsed time", () => {
    // Midnight–8 AM: 9h on the US fall-back night, 7h on spring-forward night.
    expect(shiftElapsedMinutes("2026-11-01", 0, 480, "America/New_York")).toBe(540);
    expect(shiftElapsedMinutes("2026-03-08", 0, 480, "America/New_York")).toBe(420);
    expect(shiftElapsedMinutes("2026-07-01", 0, 480, "America/New_York")).toBe(480);
    // Shifts that don't span the change are unaffected even on DST days.
    expect(shiftElapsedMinutes("2026-11-01", 540, 1020, "America/New_York")).toBe(480);
    // Southern hemisphere (Sydney falls back on 2026-04-05) and Lord Howe's 30 min.
    expect(shiftElapsedMinutes("2026-04-05", 0, 480, "Australia/Sydney")).toBe(540);
    expect(shiftElapsedMinutes("2026-04-05", 0, 480, "Australia/Lord_Howe")).toBe(510);
    // A shift running to midnight on the night Santiago skips midnight.
    expect(shiftElapsedMinutes("2026-09-05", 1200, 1440, "America/Santiago")).toBe(240);
  });

  it("measures lateness in real minutes across the repeated fall-back hour", () => {
    const tz = "America/New_York";
    // Shift scheduled 01:30 on fall-back night starts at the first 01:30 (EDT).
    expect(minutesFromScheduled("2026-11-01T05:30:00Z", "2026-11-01", 90, tz)).toBe(0);
    // Arriving at the second 01:30 (EST) is an hour late, not on time.
    expect(minutesFromScheduled("2026-11-01T06:30:00Z", "2026-11-01", 90, tz)).toBe(60);
    // A 9 AM shift on spring-forward day: 9:05 EDT is 5 minutes late.
    expect(minutesFromScheduled("2026-03-08T13:05:00Z", "2026-03-08", 540, tz)).toBe(5);
  });
});

describe("browser calendar-day Dates", () => {
  it("round-trips keys through local-noon Dates in any runtime zone", () => {
    for (const rt of RUNTIME_ZONES) {
      withRuntimeTz(rt, () => {
        for (const key of ["2026-03-08", "2026-09-06", "2026-11-01", "2026-04-05", "2026-10-04", "2028-02-29"]) {
          const d = dateFromKey(key);
          expect(localDateKey(d)).toBe(key);
          // Local setDate arithmetic stays on calendar days across DST.
          const next = new Date(d);
          next.setDate(d.getDate() + 1);
          expect(localDateKey(next)).toBe(addDaysToKey(key, 1));
          expect(d.getDay()).toBe(dayOfWeekForKey(key));
        }
      });
    }
  });

  it("anchors the store's today, not the device's, in any runtime zone", () => {
    const now = Date.parse("2026-10-06T01:00:00Z");
    for (const rt of RUNTIME_ZONES) {
      withRuntimeTz(rt, () => {
        expect(localDateKey(storeToday("America/New_York", now))).toBe("2026-10-05");
        expect(localDateKey(storeToday("Pacific/Kiritimati", now))).toBe("2026-10-06");
      });
    }
  });
});

describe("timezone validation and catalogue", () => {
  it("accepts IANA names and rejects offsets and junk", () => {
    for (const tz of [...STORE_ZONES, "Etc/GMT+5", "America/Argentina/Buenos_Aires", "America/Port-au-Prince"]) {
      expect(isValidTimezone(tz)).toBe(true);
    }
    for (const tz of ["", " ", "+05:30", "-03:00", "Mars/Olympus_Mons", "America/New York", null, 5]) {
      expect(isValidTimezone(tz)).toBe(false);
    }
    expect(resolveTimezone("Mars/Olympus_Mons")).toBe("America/New_York");
    expect(resolveTimezone(undefined)).toBe("America/New_York");
    expect(resolveTimezone("Asia/Kathmandu")).toBe("Asia/Kathmandu");
  });

  it("labels offsets, including quarter-hour and negative half-hour zones", () => {
    const jan = Date.parse("2026-01-15T12:00:00Z");
    expect(utcOffsetLabel("Asia/Kathmandu", jan)).toBe("UTC+05:45");
    expect(utcOffsetLabel("America/St_Johns", jan)).toBe("UTC−03:30");
    expect(utcOffsetLabel("Pacific/Kiritimati", jan)).toBe("UTC+14:00");
    expect(utcOffsetLabel("UTC", jan)).toBe("UTC+00:00");
  });

  it("lists every runtime zone (plus UTC), sorted by offset", () => {
    const zones = allTimezones(Date.parse("2026-01-15T12:00:00Z"));
    const values = zones.map((z) => z.value);
    expect(values).toContain("UTC");
    expect(values).toContain("Asia/Kathmandu");
    expect(values).toContain("Pacific/Kiritimati");
    expect(zones.length).toBeGreaterThan(300);
    for (let i = 1; i < zones.length; i++) expect(zones[i].offsetMin).toBeGreaterThanOrEqual(zones[i - 1].offsetMin);
  });

  it("parses HH:MM strictly", () => {
    expect(parseHHMM("00:00")).toBe(0);
    expect(parseHHMM("23:59")).toBe(1439);
    expect(parseHHMM("24:00")).toBeNull();
    expect(parseHHMM("9:00")).toBeNull();
    expect(parseHHMM("09:60")).toBeNull();
    expect(parseHHMM(undefined)).toBeNull();
  });
});

describe("dateForWeekday", () => {
  it("finds a weekday (0 = Sunday) within the 7 days from the week start", () => {
    // Monday-start week of 2026-10-05
    expect(dateForWeekday("2026-10-05", 1)).toBe("2026-10-05");
    expect(dateForWeekday("2026-10-05", 6)).toBe("2026-10-10");
    expect(dateForWeekday("2026-10-05", 0)).toBe("2026-10-11");
    // Saturday-start week of 2026-10-03
    expect(dateForWeekday("2026-10-03", 6)).toBe("2026-10-03");
    expect(dateForWeekday("2026-10-03", 0)).toBe("2026-10-04");
    expect(dateForWeekday("2026-10-03", 5)).toBe("2026-10-09");
  });
});
