import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_PAY_RULES,
  getOrgPayrollSettings,
  hasDailyRules,
  loadExemptEmployeeIds,
  overtimeThresholds,
  parsePayRules,
  payRulesRows,
  roundPunchMs,
  roundPunchTimes,
} from "./pay-rules";
import { zonedTimeToUtc } from "./dates";

const NY = "America/New_York";
// An instant at store wall time date + h:mm:ss.
const t = (date: string, h: number, m: number, s = 0, tz = NY) => zonedTimeToUtc(date, h * 60 + m, tz).getTime() + s * 1000;
const wall = (ms: number, tz = NY) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(ms);

describe("parsePayRules", () => {
  it("defaults to today's behavior: federal, Monday workweek, exact time", () => {
    expect(parsePayRules({})).toEqual({ overtimeRule: "federal", nevadaDailyOvertime: false, workweekStartDay: 1, roundingMinutes: 0 });
    expect(DEFAULT_PAY_RULES).toEqual(parsePayRules({}));
  });

  it("reads stored values", () => {
    expect(parsePayRules({
      overtime_rule: "california", overtime_nevada_daily: "true", payroll_week_start: "0", punch_rounding_minutes: "15",
    })).toEqual({ overtimeRule: "california", nevadaDailyOvertime: true, workweekStartDay: 0, roundingMinutes: 15 });
  });

  it("falls back to the default for malformed values", () => {
    expect(parsePayRules({
      overtime_rule: "texas", overtime_nevada_daily: "yes", payroll_week_start: "7", punch_rounding_minutes: "10",
    })).toEqual(DEFAULT_PAY_RULES);
    expect(parsePayRules({ payroll_week_start: "" }).workweekStartDay).toBe(1);
    expect(parsePayRules({ payroll_week_start: "1.5" }).workweekStartDay).toBe(1);
  });
});

describe("payRulesRows", () => {
  it("converts a valid patch to app_settings rows", () => {
    expect(payRulesRows({ overtimeRule: "colorado", nevadaDailyOvertime: false, workweekStartDay: 6, roundingMinutes: 6 })).toEqual({
      rows: [
        { key: "overtime_rule", value: "colorado" },
        { key: "overtime_nevada_daily", value: "false" },
        { key: "payroll_week_start", value: "6" },
        { key: "punch_rounding_minutes", value: "6" },
      ],
      error: null,
    });
    expect(payRulesRows({})).toEqual({ rows: [], error: null });
  });

  it.each([
    [{ overtimeRule: "texas" }, /overtimeRule/],
    [{ overtimeRule: 1 }, /overtimeRule/],
    [{ nevadaDailyOvertime: "true" }, /nevadaDailyOvertime/],
    [{ workweekStartDay: 7 }, /workweekStartDay/],
    [{ workweekStartDay: -1 }, /workweekStartDay/],
    [{ workweekStartDay: "1" }, /workweekStartDay/],
    [{ workweekStartDay: 1.5 }, /workweekStartDay/],
    [{ roundingMinutes: 10 }, /roundingMinutes/],
    [{ roundingMinutes: "15" }, /roundingMinutes/],
  ])("rejects %j", (input, msg) => {
    const r = payRulesRows(input as Record<string, unknown>);
    expect(r.rows).toEqual([]);
    expect(r.error).toMatch(msg);
  });
});

describe("overtimeThresholds", () => {
  it.each([
    ["federal", false, { dailyOvertime: null, dailyDoubleTime: null, weeklyOvertime: 40, seventhDay: false }],
    ["california", false, { dailyOvertime: 8, dailyDoubleTime: 12, weeklyOvertime: 40, seventhDay: true }],
    ["alaska", false, { dailyOvertime: 8, dailyDoubleTime: null, weeklyOvertime: 40, seventhDay: false }],
    ["nevada", false, { dailyOvertime: null, dailyDoubleTime: null, weeklyOvertime: 40, seventhDay: false }],
    ["nevada", true, { dailyOvertime: 8, dailyDoubleTime: null, weeklyOvertime: 40, seventhDay: false }],
    ["colorado", false, { dailyOvertime: 12, dailyDoubleTime: null, weeklyOvertime: 40, seventhDay: false }],
    ["federal", true, { dailyOvertime: null, dailyDoubleTime: null, weeklyOvertime: 40, seventhDay: false }],
  ] as const)("%s (nevada daily %s)", (overtimeRule, nevadaDailyOvertime, want) => {
    const th = overtimeThresholds({ overtimeRule, nevadaDailyOvertime });
    expect(th).toEqual(want);
    expect(hasDailyRules(th)).toBe(want.dailyOvertime !== null);
  });
});

describe("roundPunchMs", () => {
  const d = "2026-06-08";

  it("is the 7-minute rule at 15: 7 min rounds back, 8 rounds forward", () => {
    expect(wall(roundPunchMs(t(d, 9, 7), 15, NY))).toBe("09:00:00");
    expect(wall(roundPunchMs(t(d, 9, 7, 29), 15, NY))).toBe("09:00:00");
    expect(wall(roundPunchMs(t(d, 9, 7, 30), 15, NY))).toBe("09:15:00");
    expect(wall(roundPunchMs(t(d, 9, 8), 15, NY))).toBe("09:15:00");
    expect(wall(roundPunchMs(t(d, 9, 22), 15, NY))).toBe("09:15:00");
    expect(wall(roundPunchMs(t(d, 9, 23), 15, NY))).toBe("09:30:00");
    expect(wall(roundPunchMs(t(d, 9, 52, 30), 15, NY))).toBe("10:00:00");
    expect(wall(roundPunchMs(t(d, 9, 15), 15, NY))).toBe("09:15:00");
  });

  it("rounds to the nearest 5 and 6 minutes", () => {
    expect(wall(roundPunchMs(t(d, 9, 2, 29), 5, NY))).toBe("09:00:00");
    expect(wall(roundPunchMs(t(d, 9, 2, 30), 5, NY))).toBe("09:05:00");
    expect(wall(roundPunchMs(t(d, 9, 2, 59), 6, NY))).toBe("09:00:00");
    expect(wall(roundPunchMs(t(d, 9, 3), 6, NY))).toBe("09:06:00");
    expect(wall(roundPunchMs(t(d, 9, 57), 6, NY))).toBe("10:00:00");
  });

  it("returns the exact time when off", () => {
    expect(roundPunchMs(t(d, 9, 7, 13), 0, NY)).toBe(t(d, 9, 7, 13));
  });

  it("rounds on the store's clock in zones with 30- and 45-minute offsets", () => {
    const KTM = "Asia/Kathmandu"; // UTC+5:45
    expect(wall(roundPunchMs(t(d, 9, 7, 0, KTM), 15, KTM), KTM)).toBe("09:00:00");
    expect(wall(roundPunchMs(t(d, 9, 4, 0, KTM), 6, KTM), KTM)).toBe("09:06:00");
    const NF = "America/St_Johns"; // UTC−2:30 in summer
    expect(wall(roundPunchMs(t(d, 9, 8, 0, NF), 15, NF), NF)).toBe("09:15:00");
    expect(wall(roundPunchMs(t(d, 9, 2, 0, NF), 6, NF), NF)).toBe("09:00:00");
  });

  it("moves by real minutes across DST", () => {
    // Spring forward: 1:53 EST rounds to the next quarter, which is 3:00 EDT, 7 real minutes on.
    const before = t("2026-03-08", 1, 53);
    const r = roundPunchMs(before, 15, NY);
    expect(r - before).toBe(7 * 60_000);
    expect(wall(r)).toBe("03:00:00");
    // Fall back: the second 1:53 (EST) rounds to 2:00 EST, 7 real minutes on, not 67.
    const second153 = t("2026-11-01", 1, 53) + 3_600_000;
    expect(wall(second153)).toBe("01:53:00");
    expect(roundPunchMs(second153, 15, NY) - second153).toBe(7 * 60_000);
    // The first 1:53 (EDT) rounds to the instant the clock falls back.
    const first153 = t("2026-11-01", 1, 53);
    expect(roundPunchMs(first153, 15, NY) - first153).toBe(7 * 60_000);
  });
});

describe("roundPunchTimes", () => {
  const d = "2026-06-08";
  it("rounds only clock-ins and clock-outs", () => {
    const punches = [
      { punchType: "clock_in", ms: t(d, 9, 7) },
      { punchType: "break_start", ms: t(d, 12, 7) },
      { punchType: "break_end", ms: t(d, 12, 38) },
      { punchType: "clock_out", ms: t(d, 17, 8) },
    ];
    expect(roundPunchTimes(punches, 15, NY).map((ms) => wall(ms))).toEqual(["09:00:00", "12:07:00", "12:38:00", "17:15:00"]);
    expect(roundPunchTimes(punches, 0, NY)).toEqual(punches.map((p) => p.ms));
  });

  it("never moves a punch past its neighbours", () => {
    const punches = [
      { punchType: "clock_in", ms: t(d, 9, 8) },
      { punchType: "break_start", ms: t(d, 9, 10) },
      { punchType: "break_end", ms: t(d, 17, 5) },
      { punchType: "clock_out", ms: t(d, 17, 6) },
    ];
    expect(roundPunchTimes(punches, 15, NY).map((ms) => wall(ms))).toEqual(["09:10:00", "09:10:00", "17:05:00", "17:05:00"]);
  });
});

describe("loaders", () => {
  function client(result: { data: unknown; error: unknown }) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "order"]) b[m] = vi.fn().mockReturnValue(b);
    b.range = vi.fn().mockResolvedValueOnce(result).mockResolvedValue({ data: [], error: null });
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej);
    return { from: vi.fn().mockReturnValue(b), b } as never;
  }

  it("reads the timezone and pay rules together", async () => {
    const c = client({ data: [{ key: "timezone", value: "America/Denver" }, { key: "overtime_rule", value: "colorado" }], error: null });
    expect(await getOrgPayrollSettings(c, "org")).toEqual({ tz: "America/Denver", rules: { ...DEFAULT_PAY_RULES, overtimeRule: "colorado" } });
  });

  it("defaults when the org has no settings", async () => {
    expect(await getOrgPayrollSettings(client({ data: null, error: null }), "org")).toEqual({ tz: NY, rules: DEFAULT_PAY_RULES });
  });

  it("loads exempt employee ids", async () => {
    const { ids, error } = await loadExemptEmployeeIds(client({ data: [{ id: 3 }, { id: 9 }], error: null }), "org");
    expect(error).toBeNull();
    expect([...ids]).toEqual([3, 9]);
  });

  it("treats a database without the exempt column as nobody exempt", async () => {
    const { ids, error } = await loadExemptEmployeeIds(client({ data: null, error: { code: "42703" } }), "org");
    expect(error).toBeNull();
    expect(ids.size).toBe(0);
  });

  it("passes other errors on", async () => {
    const { error } = await loadExemptEmployeeIds(client({ data: null, error: { code: "XX000" } }), "org");
    expect(error).toEqual({ code: "XX000" });
  });
});
