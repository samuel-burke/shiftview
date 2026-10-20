import { describe, expect, it } from "vitest";
import {
  isWholePayPeriod,
  lastEndedPayPeriod,
  latestSignablePayPeriod,
  nextPayPeriod,
  parsePayPeriodSettings,
  payPeriodContaining,
  payPeriodForInstant,
  payPeriodSettingsRows,
  payPeriodsEnabled,
  payPeriodsOverlapping,
  previousPayPeriod,
  type PayPeriodSettings,
} from "./pay-periods";

const none: PayPeriodSettings = { frequency: "none", anchor: null };
const weekly: PayPeriodSettings = { frequency: "weekly", anchor: null };
const weeklyWed: PayPeriodSettings = { frequency: "weekly", anchor: "2026-10-07" };
const biweekly: PayPeriodSettings = { frequency: "biweekly", anchor: "2026-09-28" };
const semi: PayPeriodSettings = { frequency: "semimonthly", anchor: null };

describe("parsePayPeriodSettings", () => {
  it("defaults to none, today's behavior", () => {
    expect(parsePayPeriodSettings({})).toEqual(none);
    expect(payPeriodsEnabled(parsePayPeriodSettings({}))).toBe(false);
  });

  it("reads the frequency and anchor, ignoring case and spacing", () => {
    expect(parsePayPeriodSettings({ pay_period_frequency: " BiWeekly ", pay_period_anchor: "2026-09-28" }))
      .toEqual(biweekly);
  });

  it("treats an unknown frequency as none and a bad anchor as unset", () => {
    expect(parsePayPeriodSettings({ pay_period_frequency: "monthly" }).frequency).toBe("none");
    expect(parsePayPeriodSettings({ pay_period_frequency: "weekly", pay_period_anchor: "2026-02-30" }).anchor).toBeNull();
    expect(parsePayPeriodSettings({ pay_period_frequency: "weekly", pay_period_anchor: "" }).anchor).toBeNull();
  });

  it("biweekly with no anchor has no periods", () => {
    const s = parsePayPeriodSettings({ pay_period_frequency: "biweekly" });
    expect(payPeriodsEnabled(s)).toBe(false);
    expect(payPeriodContaining("2026-10-18", s)).toBeNull();
  });
});

// The same dates are checked against the database's pay_period_bounds in
// supabase/manual-tests/0062_pay_periods.test.sql.
describe("payPeriodContaining", () => {
  it("none: no periods", () => {
    expect(payPeriodContaining("2026-10-18", none)).toBeNull();
  });

  it("rejects a malformed date", () => {
    expect(payPeriodContaining("2026-13-01", weekly)).toBeNull();
    expect(payPeriodContaining("not a date", semi)).toBeNull();
  });

  describe("weekly", () => {
    it("runs Monday to Sunday by default", () => {
      expect(payPeriodContaining("2026-10-18", weekly)).toEqual({ start: "2026-10-12", end: "2026-10-18" });
      expect(payPeriodContaining("2026-10-12", weekly)).toEqual({ start: "2026-10-12", end: "2026-10-18" });
      expect(payPeriodContaining("2026-10-19", weekly)).toEqual({ start: "2026-10-19", end: "2026-10-25" });
    });

    it("follows the anchor's weekday", () => {
      expect(payPeriodContaining("2026-10-18", weeklyWed)).toEqual({ start: "2026-10-14", end: "2026-10-20" });
      // Dates before the anchor work the same way.
      expect(payPeriodContaining("2026-10-06", weeklyWed)).toEqual({ start: "2026-09-30", end: "2026-10-06" });
    });

    it("crosses a month and year end", () => {
      expect(payPeriodContaining("2027-01-01", weekly)).toEqual({ start: "2026-12-28", end: "2027-01-03" });
    });

    it("is seven calendar days across both DST changes", () => {
      // US spring forward 2026-03-08 and fall back 2026-11-01 are Sundays.
      expect(payPeriodContaining("2026-03-08", weekly)).toEqual({ start: "2026-03-02", end: "2026-03-08" });
      expect(payPeriodContaining("2026-03-09", weekly)).toEqual({ start: "2026-03-09", end: "2026-03-15" });
      expect(payPeriodContaining("2026-11-01", weekly)).toEqual({ start: "2026-10-26", end: "2026-11-01" });
    });
  });

  describe("biweekly", () => {
    it("counts fourteen days from the anchor", () => {
      expect(payPeriodContaining("2026-09-28", biweekly)).toEqual({ start: "2026-09-28", end: "2026-10-11" });
      expect(payPeriodContaining("2026-10-11", biweekly)).toEqual({ start: "2026-09-28", end: "2026-10-11" });
      expect(payPeriodContaining("2026-10-25", biweekly)).toEqual({ start: "2026-10-12", end: "2026-10-25" });
    });

    it("works before the anchor", () => {
      expect(payPeriodContaining("2026-09-27", biweekly)).toEqual({ start: "2026-09-14", end: "2026-09-27" });
      expect(payPeriodContaining("2025-01-01", biweekly)).toEqual({ start: "2024-12-23", end: "2025-01-05" });
    });

    it("crosses a year end and a leap day", () => {
      expect(payPeriodContaining("2027-01-01", biweekly)).toEqual({ start: "2026-12-21", end: "2027-01-03" });
      const leap: PayPeriodSettings = { frequency: "biweekly", anchor: "2028-02-21" };
      expect(payPeriodContaining("2028-03-05", leap)).toEqual({ start: "2028-02-21", end: "2028-03-05" });
      expect(payPeriodContaining("2028-02-29", leap)).toEqual({ start: "2028-02-21", end: "2028-03-05" });
    });

    it("spans a DST change as fourteen calendar days", () => {
      const s: PayPeriodSettings = { frequency: "biweekly", anchor: "2026-10-26" };
      expect(payPeriodContaining("2026-11-01", s)).toEqual({ start: "2026-10-26", end: "2026-11-08" });
      expect(payPeriodContaining("2026-11-09", s)).toEqual({ start: "2026-11-09", end: "2026-11-22" });
    });
  });

  describe("semimonthly", () => {
    it("splits on the 15th", () => {
      expect(payPeriodContaining("2026-10-01", semi)).toEqual({ start: "2026-10-01", end: "2026-10-15" });
      expect(payPeriodContaining("2026-10-15", semi)).toEqual({ start: "2026-10-01", end: "2026-10-15" });
      expect(payPeriodContaining("2026-10-16", semi)).toEqual({ start: "2026-10-16", end: "2026-10-31" });
    });

    it("ends on each month's last day", () => {
      expect(payPeriodContaining("2026-11-30", semi)).toEqual({ start: "2026-11-16", end: "2026-11-30" });
      expect(payPeriodContaining("2026-12-31", semi)).toEqual({ start: "2026-12-16", end: "2026-12-31" });
      expect(payPeriodContaining("2027-02-20", semi)).toEqual({ start: "2027-02-16", end: "2027-02-28" });
    });

    it("ends February on the 29th in leap years", () => {
      expect(payPeriodContaining("2028-02-29", semi)).toEqual({ start: "2028-02-16", end: "2028-02-29" });
      expect(payPeriodContaining("2024-02-16", semi)).toEqual({ start: "2024-02-16", end: "2024-02-29" });
      // 2100 is not a leap year.
      expect(payPeriodContaining("2100-02-28", semi)).toEqual({ start: "2100-02-16", end: "2100-02-28" });
    });

    it("ignores the anchor", () => {
      expect(payPeriodContaining("2026-10-20", { frequency: "semimonthly", anchor: "2026-10-03" }))
        .toEqual({ start: "2026-10-16", end: "2026-10-31" });
    });
  });
});

describe("previous and next periods", () => {
  it("step across month ends for semimonthly", () => {
    const p = { start: "2026-03-01", end: "2026-03-15" };
    expect(previousPayPeriod(p, semi)).toEqual({ start: "2026-02-16", end: "2026-02-28" });
    expect(nextPayPeriod({ start: "2026-12-16", end: "2026-12-31" }, semi)).toEqual({ start: "2027-01-01", end: "2027-01-15" });
  });

  it("step fourteen days for biweekly", () => {
    expect(previousPayPeriod({ start: "2026-09-28", end: "2026-10-11" }, biweekly))
      .toEqual({ start: "2026-09-14", end: "2026-09-27" });
  });
});

describe("payPeriodForInstant", () => {
  const tz = "America/New_York";

  it("uses the store's calendar, not UTC", () => {
    // Sunday 11:30 PM in New York is Monday in UTC.
    expect(payPeriodForInstant("2026-10-19T03:30:00Z", tz, weekly)).toEqual({ start: "2026-10-12", end: "2026-10-18" });
    expect(payPeriodForInstant("2026-10-19T04:30:00Z", tz, weekly)).toEqual({ start: "2026-10-19", end: "2026-10-25" });
    // Kiritimati (UTC+14) is already Monday.
    expect(payPeriodForInstant("2026-10-18T12:00:00Z", "Pacific/Kiritimati", weekly)).toEqual({ start: "2026-10-19", end: "2026-10-25" });
  });

  it("DST fall back: 11:30 PM on the 25-hour Sunday is in that week", () => {
    // 2025-11-02 23:30 EST = 2025-11-03 04:30Z.
    expect(payPeriodForInstant("2025-11-03T04:30:00Z", tz, weekly)).toEqual({ start: "2025-10-27", end: "2025-11-02" });
    // 2025-11-03 00:30 EST = 05:30Z: the next week.
    expect(payPeriodForInstant("2025-11-03T05:30:00Z", tz, weekly)).toEqual({ start: "2025-11-03", end: "2025-11-09" });
    // The repeated 1:30 AM: both instants are on the Sunday.
    expect(payPeriodForInstant("2025-11-02T05:30:00Z", tz, weekly)?.end).toBe("2025-11-02");
    expect(payPeriodForInstant("2025-11-02T06:30:00Z", tz, weekly)?.end).toBe("2025-11-02");
  });

  it("DST spring forward: 11:30 PM on the 23-hour Sunday is in that week", () => {
    // 2026-03-08 23:30 EDT = 2026-03-09 03:30Z.
    expect(payPeriodForInstant("2026-03-09T03:30:00Z", tz, weekly)).toEqual({ start: "2026-03-02", end: "2026-03-08" });
    expect(payPeriodForInstant("2026-03-09T04:00:00Z", tz, weekly)).toEqual({ start: "2026-03-09", end: "2026-03-15" });
  });

  it("semimonthly midnight on the 16th starts the second half", () => {
    expect(payPeriodForInstant("2026-10-16T03:59:59Z", tz, semi)?.start).toBe("2026-10-01");
    expect(payPeriodForInstant("2026-10-16T04:00:00Z", tz, semi)?.start).toBe("2026-10-16");
  });

  it("none: no period", () => {
    expect(payPeriodForInstant("2026-10-16T04:00:00Z", tz, none)).toBeNull();
  });
});

describe("payPeriodsOverlapping and isWholePayPeriod", () => {
  it("lists every period touching the range", () => {
    expect(payPeriodsOverlapping("2026-10-10", "2026-10-20", semi)).toEqual([
      { start: "2026-10-01", end: "2026-10-15" },
      { start: "2026-10-16", end: "2026-10-31" },
    ]);
    expect(payPeriodsOverlapping("2026-10-12", "2026-10-18", weekly)).toEqual([{ start: "2026-10-12", end: "2026-10-18" }]);
  });

  it("is empty with no periods or a bad range", () => {
    expect(payPeriodsOverlapping("2026-10-01", "2026-10-31", none)).toEqual([]);
    expect(payPeriodsOverlapping("2026-10-31", "2026-10-01", weekly)).toEqual([]);
  });

  it("knows when a range is exactly one period", () => {
    expect(isWholePayPeriod("2026-10-12", "2026-10-18", weekly)).toBe(true);
    expect(isWholePayPeriod("2026-10-12", "2026-10-17", weekly)).toBe(false);
    expect(isWholePayPeriod("2026-10-13", "2026-10-18", weekly)).toBe(false);
    expect(isWholePayPeriod("2028-02-16", "2028-02-29", semi)).toBe(true);
    expect(isWholePayPeriod("2026-10-12", "2026-10-18", none)).toBe(false);
  });
});

describe("latestSignablePayPeriod and lastEndedPayPeriod", () => {
  it("on a period's last day, that period is signable but not yet ended", () => {
    expect(latestSignablePayPeriod("2026-10-18", weekly)).toEqual({ start: "2026-10-12", end: "2026-10-18" });
    expect(lastEndedPayPeriod("2026-10-18", weekly)).toEqual({ start: "2026-10-05", end: "2026-10-11" });
  });

  it("mid-period, the previous one", () => {
    expect(latestSignablePayPeriod("2026-10-14", weekly)).toEqual({ start: "2026-10-05", end: "2026-10-11" });
    expect(latestSignablePayPeriod("2026-03-01", semi)).toEqual({ start: "2026-02-16", end: "2026-02-28" });
    expect(lastEndedPayPeriod("2026-10-16", semi)).toEqual({ start: "2026-10-01", end: "2026-10-15" });
  });

  it("none: nothing to sign", () => {
    expect(latestSignablePayPeriod("2026-10-18", none)).toBeNull();
    expect(lastEndedPayPeriod("2026-10-18", none)).toBeNull();
  });
});

describe("payPeriodSettingsRows", () => {
  it("writes the frequency and anchor", () => {
    expect(payPeriodSettingsRows({ frequency: "biweekly", anchor: "2026-09-28" }, none)).toEqual({
      rows: [
        { key: "pay_period_frequency", value: "biweekly" },
        { key: "pay_period_anchor", value: "2026-09-28" },
      ],
      error: null,
    });
  });

  it("clears the anchor with null", () => {
    expect(payPeriodSettingsRows({ anchor: null }, weekly).rows).toEqual([{ key: "pay_period_anchor", value: "" }]);
  });

  it("turns pay periods off", () => {
    expect(payPeriodSettingsRows({ frequency: "none" }, biweekly).rows).toEqual([{ key: "pay_period_frequency", value: "none" }]);
  });

  it("refuses biweekly without an anchor, given or stored", () => {
    expect(payPeriodSettingsRows({ frequency: "biweekly" }, none).error).toMatch(/anchor/);
    expect(payPeriodSettingsRows({ anchor: null }, biweekly).error).toMatch(/anchor/);
    expect(payPeriodSettingsRows({ frequency: "biweekly" }, { frequency: "weekly", anchor: "2026-09-28" }).error).toBeNull();
  });

  it("refuses bad values", () => {
    expect(payPeriodSettingsRows({ frequency: "monthly" }, none).error).toMatch(/frequency/);
    expect(payPeriodSettingsRows({ anchor: "2026-02-30" }, none).error).toMatch(/anchor/);
    expect(payPeriodSettingsRows({ anchor: 20260928 }, none).error).toMatch(/anchor/);
    expect(payPeriodSettingsRows("weekly", none).error).toMatch(/object/);
    expect(payPeriodSettingsRows(null, none).error).toMatch(/object/);
    expect(payPeriodSettingsRows({}, none).error).toMatch(/no fields/);
  });
});
