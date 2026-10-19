// The payroll export with break types and the meal rule (migration 0065).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER, MOCK_ORG_ID } from "../../../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: any, init?: { status?: number }) =>
      new Response(JSON.stringify(data), { status: init?.status ?? 200, headers: { "Content-Type": "application/json" } }),
  },
}));

const mockCreateClient = vi.mocked(createClient);

function makeClient(punches: any[], { settings = {} as Record<string, string>, breakTypes = [] as any[], isManager = true } = {}) {
  const selects: string[] = [];
  const builder = (table: string) => {
    const b: any = {};
    const filters: Record<string, unknown> = {};
    for (const m of ["order", "limit", "in", "gte", "lte"]) b[m] = vi.fn().mockReturnValue(b);
    b.select = vi.fn((cols: string) => { if (table === "punch_records") selects.push(cols); return b; });
    b.eq = vi.fn((c: string, v: unknown) => { filters[c] = v; return b; });
    const rows = () => {
      if (table === "punch_records") return punches;
      if (table === "break_types") return breakTypes;
      if (table === "app_settings") {
        const all = Object.entries({ timezone: "America/New_York", ...settings }).map(([key, value]) => ({ key, value }));
        return filters.key ? all.filter((r) => r.key === filters.key) : all;
      }
      return [];
    };
    b.range = vi.fn((from: number, to: number) => Promise.resolve({ data: rows().slice(from, to + 1), error: null }));
    b.maybeSingle = vi.fn().mockResolvedValue({
      data: table === "managers" && isManager ? { user_id: MOCK_USER.id, org_id: MOCK_ORG_ID, is_owner: false } : null,
      error: null,
    });
    b.single = b.maybeSingle;
    b.then = (resolve: any, reject: any) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
    return b;
  };
  return {
    selects,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }) },
    from: vi.fn().mockImplementation(builder),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

let nextId = 1;
const p = (punch_type: string, punched_at: string, extra: Record<string, unknown> = {}) =>
  ({ id: nextId++, employee_id: 1, punch_type, punched_at, employees: { name: "Ann" }, ...extra });

// Mon Jun 8 2026, 9 AM–5 PM EDT, a paid 15-minute rest and an unpaid 30-minute meal.
const mixedDay = () => [
  p("clock_in", "2026-06-08T13:00:00.000Z"),
  p("break_start", "2026-06-08T15:00:00.000Z", { break_paid: true, break_type_id: 1 }),
  p("break_end", "2026-06-08T15:15:00.000Z"),
  p("break_start", "2026-06-08T17:00:00.000Z", { break_paid: false, break_type_id: 2 }),
  p("break_end", "2026-06-08T17:30:00.000Z"),
  p("clock_out", "2026-06-08T21:00:00.000Z"),
];
// Tue Jun 9, 9 AM–4 PM with no break: a missed meal under a 5-hour rule.
const noMealDay = () => [p("clock_in", "2026-06-09T13:00:00.000Z"), p("clock_out", "2026-06-09T20:00:00.000Z")];

const req = (qs: string) => new Request(`http://localhost/api/reports/payroll/export?${qs}`);

beforeEach(() => vi.clearAllMocks());

describe("GET /api/reports/payroll/export — break types", () => {
  it("reads each break's paid flag and pays the paid one", async () => {
    const client = makeClient(mixedDay());
    mockCreateClient.mockResolvedValue(client as any);
    const lines = (await (await GET(req("from=2026-06-08&to=2026-06-14&format=daily"))).text()).split("\n");
    expect(client.selects[0]).toContain("break_paid");
    expect(lines[0]).toBe("Employee,Date,Day,Hours Worked,Break Hours,Incomplete");
    expect(lines[1]).toBe("Ann,2026-06-08,Mon,7.50,0.50,");
  });

  it("adds no Meal Flags column while the meal rule is off", async () => {
    mockCreateClient.mockResolvedValue(makeClient([...mixedDay(), ...noMealDay()]) as any);
    const csv = await (await GET(req("from=2026-06-08&to=2026-06-14&format=summary"))).text();
    expect(csv.split("\n")[0]).toBe("Employee,Week Of,Regular Hrs,OT Hrs,Break Hrs,Total Hrs,Incomplete");
  });

  it("counts missed and late meals in the summary and daily exports when the rule is on", async () => {
    const settings = { meal_required_after_minutes: "300" };
    const breakTypes = [
      { id: 1, name: "Rest", paid: true, min_minutes: 10, sort_order: 0, archived_at: null },
      { id: 2, name: "Meal", paid: false, min_minutes: 30, sort_order: 1, archived_at: null },
    ];
    // Wed Jun 10: meal at 6h of work, late.
    const lateDay = [
      p("clock_in", "2026-06-10T13:00:00.000Z"),
      p("break_start", "2026-06-10T19:00:00.000Z", { break_type_id: 2 }),
      p("break_end", "2026-06-10T19:30:00.000Z"),
      p("clock_out", "2026-06-10T21:00:00.000Z"),
    ];
    const punches = [...mixedDay(), ...noMealDay(), ...lateDay];

    mockCreateClient.mockResolvedValue(makeClient(punches, { settings, breakTypes }) as any);
    const summary = (await (await GET(req("from=2026-06-08&to=2026-06-14&format=summary"))).text()).split("\n");
    expect(summary[0]).toBe("Employee,Week Of,Regular Hrs,OT Hrs,Break Hrs,Total Hrs,Incomplete,Meal Flags");
    expect(summary[1].endsWith(",2")).toBe(true);

    mockCreateClient.mockResolvedValue(makeClient(punches, { settings, breakTypes }) as any);
    const daily = (await (await GET(req("from=2026-06-08&to=2026-06-14&format=daily"))).text()).split("\n");
    expect(daily[0].endsWith(",Meal Flags")).toBe(true);
    expect(daily.slice(1).map((l) => l.split(",").at(-1))).toEqual(["0", "1", "1"]);
  });

  it("is still manager-only", async () => {
    mockCreateClient.mockResolvedValue(makeClient(mixedDay(), { isManager: false }) as any);
    expect((await GET(req("from=2026-06-08&to=2026-06-14"))).status).toBe(403);
  });
});
