import { describe, it, expect } from "vitest";
import { loadCarriedOverPunches } from "./current-shift-server";

function makeClient(tables: Record<string, Record<string, unknown>[]>) {
  return {
    from(table: string) {
      const filters: ((r: Record<string, unknown>) => boolean)[] = [];
      const rows = () => (tables[table] ?? [])
        .filter((r) => filters.every((f) => f(r)))
        .sort((a, b) => String(a.punched_at ?? "").localeCompare(String(b.punched_at ?? "")));
      const b: any = {
        select: () => b,
        order: () => b,
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
        gt: (c: string, v: number) => { filters.push((r) => Number(r[c]) > v); return b; },
        in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return b; },
        gte: (c: string, v: string) => { filters.push((r) => new Date(String(r[c])) >= new Date(v)); return b; },
        lte: (c: string, v: string) => { filters.push((r) => new Date(String(r[c])) <= new Date(v)); return b; },
        then: (res: any, rej: any) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
      };
      return b;
    },
  };
}

const ORG = "org-1";
const TZ = "America/New_York";
const punch = (id: number, employee_id: number, punch_type: string, punched_at: string) =>
  ({ id, org_id: ORG, employee_id, punch_type, punched_at });

describe("loadCarriedOverPunches", () => {
  const tables = {
    punch_records: [
      punch(1, 1, "clock_in", "2026-01-15T21:00:00Z"),  // closer, 4 PM, still open
      punch(2, 2, "clock_in", "2026-01-15T14:00:00Z"),  // opener, clocked out
      punch(3, 2, "clock_out", "2026-01-15T22:00:00Z"),
      punch(4, 3, "clock_in", "2026-01-16T03:00:00Z"),  // overnight 10 PM – 6 AM
      punch(5, 4, "clock_in", "2026-01-16T13:00:00Z"),  // today's opener
    ],
    schedules: [{ org_id: ORG, employee_id: 3, date: "2026-01-15", start_minutes: 1320, end_minutes: 1800 }],
  };

  it("returns open shifts from before midnight for the whole org", async () => {
    const { punches } = await loadCarriedOverPunches(makeClient(tables), ORG, TZ, Date.parse("2026-01-16T05:30:00Z"));
    expect(punches.map((p) => p.id).sort()).toEqual([1, 4]);
  });

  it("keeps a scheduled overnight shift past 4:00 AM, but not an unscheduled one", async () => {
    const { punches } = await loadCarriedOverPunches(makeClient(tables), ORG, TZ, Date.parse("2026-01-16T10:30:00Z")); // 5:30 AM
    expect(punches.map((p) => p.id)).toEqual([4]);
  });

  it("can be limited to one employee", async () => {
    const { punches } = await loadCarriedOverPunches(makeClient(tables), ORG, TZ, Date.parse("2026-01-16T05:30:00Z"), 3);
    expect(punches.map((p) => p.id)).toEqual([4]);
  });
});
