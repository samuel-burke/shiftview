import { describe, it, expect } from "vitest";
import { loadWeek } from "./auto-schedule-server";

// Every query resolves to its table's rows; filters are ignored.
function makeClient(tables: Record<string, Record<string, unknown>[]>) {
  return {
    rpc: () => Promise.resolve({ data: [], error: null }),
    from(table: string) {
      const b: any = new Proxy({}, {
        get: (_t, prop) =>
          prop === "then"
            ? (res: any, rej: any) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(res, rej)
            : () => b,
      });
      return b;
    },
  };
}

describe("loadWeek", () => {
  it("keeps a drafted removal's day off the table for Auto-schedule", async () => {
    const client = makeClient({
      employees: [{ id: 5, name: "Sam" }],
      schedules: [{ id: 3, employee_id: 5, date: "2026-03-09", start_minutes: 540, end_minutes: 1020 }],
      draft_schedules: [
        { id: 20, employee_id: 5, date: "2026-03-09", start_minutes: 540, end_minutes: 1020, replaces_schedule_id: 3, removes: true },
      ],
    });
    const { week } = await loadWeek(client as never, "org-1", "2026-03-08");
    // The removed shift no longer counts as worked, but the day stays taken.
    expect(week!.published).toEqual([]);
    expect(week!.employees[0].unavailableDates).toContain("2026-03-09");
  });
});
