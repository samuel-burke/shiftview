import { describe, it, expect } from "vitest";
import { findShiftConflict, findShiftOverlap } from "./shift-conflicts-server";

// Minimal query-builder mock that honours eq/gte/lte filters over in-memory tables.
function makeClient(tables: Record<string, Record<string, unknown>[]>) {
  return {
    from(table: string) {
      const filters: ((r: Record<string, unknown>) => boolean)[] = [];
      const rows = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const b: any = {
        select: () => b,
        eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b; },
        gte: (c: string, v: string) => { filters.push((r) => String(r[c]) >= v); return b; },
        lte: (c: string, v: string) => { filters.push((r) => String(r[c]) <= v); return b; },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        then: (res: any, rej: any) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
      };
      return b;
    },
  };
}

const ORG = "org-1";

describe("findShiftOverlap", () => {
  const client = makeClient({
    schedules: [
      { id: 1, org_id: ORG, employee_id: 5, date: "2026-03-08", start_minutes: 300, end_minutes: 780 },  // Sun 5 AM – 1 PM
      { id: 2, org_id: ORG, employee_id: 5, date: "2026-03-06", start_minutes: 1320, end_minutes: 1800 }, // Fri 10 PM – Sat 6 AM
    ],
  });

  it("rejects an overnight shift running into the next morning's shift", async () => {
    expect(await findShiftOverlap(client, "schedules", ORG, 5, "2026-03-07", 1320, 1800)).toMatch(/Overlaps/);
  });

  it("rejects a morning shift that starts before last night's shift ends", async () => {
    expect(await findShiftOverlap(client, "schedules", ORG, 5, "2026-03-07", 300, 600)).toMatch(/Overlaps/);
  });

  it("allows back-to-back shifts and ignores the shift being edited", async () => {
    expect(await findShiftOverlap(client, "schedules", ORG, 5, "2026-03-07", 1320, 1740)).toBeNull();
    expect(await findShiftOverlap(client, "schedules", ORG, 5, "2026-03-07", 360, 600)).toBeNull();
    expect(await findShiftOverlap(client, "schedules", ORG, 5, "2026-03-07", 300, 600, 2)).toBeNull();
  });
});

describe("findShiftConflict", () => {
  // Availability: Saturday (6) 4 PM – midnight; Sunday (0) 8 AM – 5 PM.
  const availability = [
    { id: 1, org_id: ORG, employee_id: 5, day_of_week: 6, start_minutes: 960, end_minutes: 1440 },
    { id: 2, org_id: ORG, employee_id: 5, day_of_week: 0, start_minutes: 480, end_minutes: 1020 },
  ];

  it("checks the after-midnight part against the next day's availability", async () => {
    const client = makeClient({ availability, time_off_requests: [] });
    const c = await findShiftConflict(client, ORG, 5, "2026-03-07", 1320, 1800);
    expect(c).toMatchObject({ conflict: "availability" });
    expect(c?.message).toMatch(/after-midnight part.*Sunday/);
  });

  it("flags approved time off on the next day", async () => {
    const client = makeClient({
      availability: [],
      time_off_requests: [{ id: 1, org_id: ORG, employee_id: 5, date: "2026-03-08", status: "approved" }],
    });
    expect(await findShiftConflict(client, ORG, 5, "2026-03-07", 1320, 1800)).toMatchObject({ conflict: "time_off" });
  });

  it("passes when both days are available", async () => {
    const client = makeClient({
      availability: [availability[0], { ...availability[1], start_minutes: 0 }],
      time_off_requests: [],
    });
    expect(await findShiftConflict(client, ORG, 5, "2026-03-07", 1320, 1800)).toBeNull();
  });
});
