import { describe, it, expect, vi } from "vitest";
import {
  apportion,
  constantRateLookup,
  loadRateLookup,
  makeRateLookup,
  payCents,
  RATE_BEGINNING,
  toPayRateRows,
  type PayRateRow,
} from "./pay-rates";

const base = (effectiveFrom: string, hourlyRate: number | null, employeeId = 1): PayRateRow =>
  ({ employeeId, positionId: null, effectiveFrom, hourlyRate });
const pos = (positionId: number, effectiveFrom: string, hourlyRate: number, employeeId = 1): PayRateRow =>
  ({ employeeId, positionId, effectiveFrom, hourlyRate });

describe("makeRateLookup — the rate in effect on a store-local date", () => {
  const rates = makeRateLookup([
    base(RATE_BEGINNING, 15),
    base("2026-06-10", 20),
    base("2026-09-01", 22),
    pos(7, "2026-07-01", 25),
    base(RATE_BEGINNING, 30, 2),
  ]);

  it("uses the migrated rate for any day before the first change", () => {
    expect(rates(1, "2001-01-01").rate).toBe(15);
    expect(rates(1, "2026-06-09").rate).toBe(15);
  });

  it("switches on the effective date itself, not the day after", () => {
    expect(rates(1, "2026-06-10").rate).toBe(20);
    expect(rates(1, "2026-08-31").rate).toBe(20);
    expect(rates(1, "2026-09-01").rate).toBe(22);
  });

  it("gives a position rate for hours in that position from its date", () => {
    expect(rates(1, "2026-06-30", 7)).toEqual({ rate: 20, positionRate: false });
    expect(rates(1, "2026-07-01", 7)).toEqual({ rate: 25, positionRate: true });
  });

  it("keeps the position rate after a later base raise (it overrides the base rate)", () => {
    expect(rates(1, "2026-09-02", 7)).toEqual({ rate: 25, positionRate: true });
    expect(rates(1, "2026-09-02")).toEqual({ rate: 22, positionRate: false });
  });

  it("uses the base rate for a position the employee has no rate for", () => {
    expect(rates(1, "2026-07-02", 99)).toEqual({ rate: 20, positionRate: false });
  });

  it("keeps employees apart", () => {
    expect(rates(2, "2026-07-02", 7).rate).toBe(30);
    expect(rates(3, "2026-07-02").rate).toBeNull();
  });

  it("treats a null base row as no rate from that date", () => {
    const r = makeRateLookup([base(RATE_BEGINNING, 15), base("2026-06-10", null)]);
    expect(r(1, "2026-06-09").rate).toBe(15);
    expect(r(1, "2026-06-10").rate).toBeNull();
  });

  it("doesn't depend on the order rows arrive in", () => {
    const r = makeRateLookup([base("2026-06-10", 20), base(RATE_BEGINNING, 15)]);
    expect(r(1, "2026-06-09").rate).toBe(15);
    expect(r(1, "2026-06-10").rate).toBe(20);
  });

  it("gives no rate before the first row", () => {
    expect(makeRateLookup([base("2026-06-10", 20)])(1, "2026-06-09").rate).toBeNull();
  });
});

describe("toPayRateRows", () => {
  it("reads numeric strings and timestamps from the API", () => {
    expect(toPayRateRows([{ id: "3", employee_id: "1", position_id: null, effective_from: "2026-06-10", hourly_rate: "18.50" }]))
      .toEqual([{ id: 3, employeeId: 1, positionId: null, effectiveFrom: "2026-06-10", hourlyRate: 18.5 }]);
    expect(toPayRateRows(null)).toEqual([]);
  });
});

describe("payCents — money to the cent", () => {
  it("multiplies hundredths of an hour by the rate", () => {
    expect(payCents(800, 15)).toBe(12000);
    expect(payCents(777, 15.33)).toBe(11911); // 7.77 × 15.33 = 119.1141
  });

  it("rounds half a cent up", () => {
    expect(payCents(1, 1, 1.5)).toBe(2); // 0.01h × $1 × 1.5 = 1.5¢
    expect(payCents(1, 0.5)).toBe(1); // 0.5¢
    expect(payCents(1, 0.49)).toBe(0);
  });

  it("pays overtime at 1.5× and double time at 2×", () => {
    expect(payCents(1000, 20, 1.5)).toBe(30000);
    expect(payCents(1000, 20, 2)).toBe(40000);
    expect(payCents(333, 17.77, 1.5)).toBe(8876); // 3.33 × 26.655 = 88.76115
  });

  it("has no floating-point drift", () => {
    // 0.1 + 0.2 territory: 0.29h × $0.10 is 2.9¢ → 3¢; 1.15h × $19.99 is 22.9885 → $22.99.
    expect(payCents(29, 0.1)).toBe(3);
    expect(payCents(115, 19.99)).toBe(2299);
    expect(payCents(100, 0.07 * 3)).toBe(21);
  });
});

describe("apportion", () => {
  it("splits a total so the parts add up exactly", () => {
    const parts = apportion(100, [1, 1, 1]);
    expect(parts.reduce((s, x) => s + x, 0)).toBe(100);
    expect(parts).toEqual([34, 33, 33]);
  });

  it("follows the weights", () => {
    expect(apportion(800, [4, 4])).toEqual([400, 400]);
    expect(apportion(1000, [3, 1])).toEqual([750, 250]);
  });

  it("puts everything on the first part when there is nothing to weigh by", () => {
    expect(apportion(5, [0, 0])).toEqual([5, 0]);
    expect(apportion(0, [])).toEqual([]);
  });
});

describe("loadRateLookup", () => {
  function client({ history, historyError = null, rpc = [] as unknown[] }: { history?: unknown[]; historyError?: unknown; rpc?: unknown[] }) {
    const b: any = {};
    for (const m of ["select", "eq", "order"]) b[m] = vi.fn().mockReturnValue(b);
    b.range = vi.fn((from: number) =>
      Promise.resolve(historyError ? { data: null, error: historyError } : { data: from === 0 ? history : [], error: null })
    );
    return { from: vi.fn().mockReturnValue(b), rpc: vi.fn().mockResolvedValue({ data: rpc, error: null }) };
  }

  it("reads the history when it exists", async () => {
    const { lookup, error } = await loadRateLookup(
      client({ history: [{ id: 1, employee_id: 1, position_id: null, effective_from: "2026-06-10", hourly_rate: "20" }] }) as any,
      "org"
    );
    expect(error).toBeNull();
    expect(lookup(1, "2026-06-10").rate).toBe(20);
    expect(lookup(1, "2026-06-09").rate).toBeNull();
  });

  it("falls back to the single current rate before migration 0061", async () => {
    for (const code of ["42P01", "PGRST205"]) {
      const { lookup, error } = await loadRateLookup(
        client({ historyError: { code }, rpc: [{ employee_id: 1, pay_rate: "17" }] }) as any,
        "org"
      );
      expect(error).toBeNull();
      expect(lookup(1, "2001-01-01").rate).toBe(17);
    }
  });

  it("reports any other error", async () => {
    const { error } = await loadRateLookup(client({ historyError: { code: "42501" } }) as any, "org");
    expect(error).toEqual({ code: "42501" });
  });

  it("constantRateLookup gives one rate on every day", () => {
    const r = constantRateLookup(new Map([[1, 12]]));
    expect(r(1, "1999-01-01", 5)).toEqual({ rate: 12, positionRate: false });
    expect(r(2, "1999-01-01").rate).toBeNull();
  });
});
