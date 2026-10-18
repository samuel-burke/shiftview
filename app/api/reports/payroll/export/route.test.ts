import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { GET as GET_REPORT } from "../route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER, MOCK_ORG_ID } from "../../../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (data: any, init?: { status?: number }) =>
      new Response(JSON.stringify(data), {
        status: init?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
  },
}));

const mockCreateClient = vi.mocked(createClient);

// punch_records honours gte/lte on punched_at and serves at most `cap` rows per
// request, like the Supabase API's max-rows setting.
function makeClient(punches: any[], { cap = 1000, tz = "America/New_York" } = {}) {
  const calls: { gte?: string; lte?: string }[] = [];
  const builder = (table: string) => {
    const b: any = {};
    const filters: { gte?: string; lte?: string } = {};
    for (const m of ["select", "eq", "order", "limit", "in"]) b[m] = vi.fn().mockReturnValue(b);
    b.gte = vi.fn((_c: string, v: string) => { filters.gte = v; return b; });
    b.lte = vi.fn((_c: string, v: string) => { filters.lte = v; return b; });
    const rows = () =>
      table === "punch_records"
        ? punches.filter((p) => (!filters.gte || p.punched_at >= filters.gte) && (!filters.lte || p.punched_at <= filters.lte))
        : table === "app_settings" ? [{ key: "timezone", value: tz }] : [];
    b.range = vi.fn((from: number, to: number) => {
      calls.push({ ...filters });
      return Promise.resolve({ data: rows().slice(from, Math.min(to + 1, from + cap)), error: null });
    });
    b.maybeSingle = vi.fn().mockResolvedValue({
      data: table === "managers" ? { user_id: MOCK_USER.id, org_id: MOCK_ORG_ID, is_owner: false } : null,
      error: null,
    });
    b.single = b.maybeSingle;
    b.then = (resolve: any, reject: any) => Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
    return b;
  };
  return {
    calls,
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: MOCK_USER }, error: null }) },
    from: vi.fn().mockImplementation(builder),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  };
}

let nextId = 1;
const p = (punch_type: string, punched_at: string, employee_id = 1, name = "Ann") =>
  ({ id: nextId++, employee_id, punch_type, punched_at, employees: { name } });

// 10h a day, Mon–Fri Jun 8–12 2026 (EDT): 50h in one workweek.
function tenHourWeek(employee_id = 1, name = "Ann") {
  const out: any[] = [];
  for (const d of ["08", "09", "10", "11", "12"]) {
    out.push(p("clock_in", `2026-06-${d}T13:00:00.000Z`, employee_id, name));
    out.push(p("clock_out", `2026-06-${d}T23:00:00.000Z`, employee_id, name));
  }
  return out;
}

const req = (qs: string) => new Request(`http://localhost/api/reports/payroll/export?${qs}`);

beforeEach(() => vi.clearAllMocks());

describe("GET /api/reports/payroll/export — timekeeping audit regressions", () => {
  it("reads the workweek before a mid-week range, so overtime isn't lost", async () => {
    const client = makeClient(tenHourWeek());
    mockCreateClient.mockResolvedValue(client as any);
    const res = await GET(req("from=2026-06-11&to=2026-06-15&format=summary"));
    expect(res.status).toBe(200);
    const lines = (await res.text()).split("\n");
    // Mon–Wed (before the range) were 30h: Thu takes the week to 40, Fri is overtime.
    expect(lines[1]).toBe("Ann,2026-06-08,10.00,10.00,0.00,20.00,,0.00,0.00");
    // Query starts the Sunday before Mon Jun 8 (local midnight, EDT).
    expect(client.calls[0].gte).toBe("2026-06-07T04:00:00.000Z");
  });

  it("shows hours worked before the period in the breakdown", async () => {
    mockCreateClient.mockResolvedValue(makeClient(tenHourWeek()) as any);
    const text = await (await GET(req("from=2026-06-11&to=2026-06-15&format=detailed"))).text();
    expect(text).toContain("Ann,2026-06-08,,Worked before this period,30.00,30.00,,,,");
    expect(text).toContain("Ann,2026-06-08,2026-06-11,Thu,10.00,40.00,10.00,0.00,0.00,");
    expect(text).toContain("Ann,2026-06-08,2026-06-12,Fri,10.00,50.00,0.00,10.00,0.00,");
  });

  it("pages past the API's row cap instead of dropping later employees", async () => {
    const punches = [...tenHourWeek(1, "Ann"), ...tenHourWeek(2, "Ben"), ...tenHourWeek(3, "Cy")];
    mockCreateClient.mockResolvedValue(makeClient(punches, { cap: 7 }) as any);
    const res = await GET_REPORT(new Request("http://localhost/api/reports/payroll?from=2026-06-08&to=2026-06-14"));
    const body = await res.json();
    expect(body.rows.map((r: any) => [r.employeeName, r.totalWorkedHours, r.totalOvertimeHours])).toEqual([
      ["Ann", 50, 10], ["Ben", 50, 10], ["Cy", 50, 10],
    ]);
  });

  it("never writes a 0.00-hour QuickBooks line", async () => {
    // Day lengths that sum to exactly 40.00h but not in floating point.
    const punches: any[] = [];
    [8.72, 6.78, 8.46, 9.41, 6.63].forEach((h, i) => {
      const start = Date.UTC(2026, 5, 8 + i, 12);
      punches.push(p("clock_in", new Date(start).toISOString()));
      punches.push(p("clock_out", new Date(start + Math.round(h * 3_600_000)).toISOString()));
    });
    mockCreateClient.mockResolvedValue(makeClient(punches) as any);
    const iif = await (await GET(req("from=2026-06-08&to=2026-06-14&format=qb-iif"))).text();
    const timeacts = iif.split("\n").filter((l) => l.startsWith("TIMEACT\t"));
    expect(timeacts).toHaveLength(5);
    expect(timeacts.every((l) => l.split("\t")[4] === "Regular Time")).toBe(true);
    expect(timeacts.some((l) => l.split("\t")[5] === "0.00")).toBe(false);
  });

  it("splits a QuickBooks day that crosses 40h into regular and overtime lines", async () => {
    mockCreateClient.mockResolvedValue(makeClient(tenHourWeek()) as any);
    const iif = await (await GET(req("from=2026-06-08&to=2026-06-14&format=qb-iif"))).text();
    const lines = iif.split("\n").filter((l) => l.startsWith("TIMEACT\t")).map((l) => l.split("\t").slice(1, 6).join("|"));
    expect(lines).toEqual([
      "06/08/2026||Ann|Regular Time|10.00",
      "06/09/2026||Ann|Regular Time|10.00",
      "06/10/2026||Ann|Regular Time|10.00",
      "06/11/2026||Ann|Regular Time|10.00",
      "06/12/2026||Ann|Overtime|10.00",
    ]);
  });

  it("keeps a tab in an employee name from splitting an IIF record", async () => {
    mockCreateClient.mockResolvedValue(makeClient(tenHourWeek(1, "Ann\tLee")) as any);
    const iif = await (await GET(req("from=2026-06-08&to=2026-06-14&format=qb-iif"))).text();
    for (const l of iif.split("\n").filter((x) => x.startsWith("TIMEACT\t"))) expect(l.split("\t")).toHaveLength(10);
  });

  it("defuses a formula in an employee name", async () => {
    mockCreateClient.mockResolvedValue(makeClient(tenHourWeek(1, "=cmd|' /C calc'!A0")) as any);
    const csv = await (await GET(req("from=2026-06-08&to=2026-06-14&format=daily"))).text();
    expect(csv.split("\n")[1].startsWith("'=cmd")).toBe(true);
  });
});
