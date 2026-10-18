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
function makeClient(
  punches: any[],
  { cap = 1000, tz = "America/New_York", settings = [] as { key: string; value: string }[], exemptIds = [] as number[], isManager = true } = {},
) {
  const calls: { table: string; gte?: string; lte?: string }[] = [];
  const builder = (table: string) => {
    const b: any = {};
    const filters: { gte?: string; lte?: string } = {};
    for (const m of ["select", "eq", "order", "limit", "in"]) b[m] = vi.fn().mockReturnValue(b);
    b.gte = vi.fn((_c: string, v: string) => { filters.gte = v; return b; });
    b.lte = vi.fn((_c: string, v: string) => { filters.lte = v; return b; });
    const rows = () =>
      table === "punch_records"
        ? punches.filter((p) => (!filters.gte || p.punched_at >= filters.gte) && (!filters.lte || p.punched_at <= filters.lte))
        : table === "app_settings" ? [{ key: "timezone", value: tz }, ...settings]
        : table === "employees" ? exemptIds.map((id) => ({ id })) : [];
    b.range = vi.fn((from: number, to: number) => {
      calls.push({ table, ...filters });
      return Promise.resolve({ data: rows().slice(from, Math.min(to + 1, from + cap)), error: null });
    });
    b.maybeSingle = vi.fn().mockResolvedValue({
      data: table === "managers" && isManager ? { user_id: MOCK_USER.id, org_id: MOCK_ORG_ID, is_owner: false } : null,
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
    expect(lines[1]).toBe("Ann,2026-06-08,10.00,10.00,0.00,20.00,");
    // Query starts the Sunday before Mon Jun 8 (local midnight, EDT).
    expect(client.calls.find((c) => c.table === "punch_records")!.gte).toBe("2026-06-07T04:00:00.000Z");
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

// ── Pay rules (overtime rule, exempt, workweek start, rounding) ──────────────

// Mon–Fri Jun 8–12 2026 in Los Angeles, `hours` a day from 6 AM.
function laWeek(hours: number, employee_id = 1, name = "Ann") {
  const out: any[] = [];
  for (const d of ["08", "09", "10", "11", "12"]) {
    const start = Date.parse(`2026-06-${d}T13:00:00.000Z`); // 6 AM PDT
    out.push(p("clock_in", new Date(start).toISOString(), employee_id, name));
    out.push(p("clock_out", new Date(start + hours * 3_600_000).toISOString(), employee_id, name));
  }
  return out;
}
const CA = { tz: "America/Los_Angeles", settings: [{ key: "overtime_rule", value: "california" }] };

describe("GET /api/reports/payroll/export — pay rules", () => {
  it("adds a DT Hrs column under California and fills it", async () => {
    mockCreateClient.mockResolvedValue(makeClient(laWeek(13), CA) as any);
    const lines = (await (await GET(req("from=2026-06-08&to=2026-06-14&format=summary"))).text()).split("\n");
    expect(lines[0]).toBe("Employee,Week Of,Regular Hrs,OT Hrs,DT Hrs,Break Hrs,Total Hrs,Incomplete");
    // 13h a day: 8 regular, 4 overtime, 1 double time.
    expect(lines[1]).toBe("Ann,2026-06-08,40.00,20.00,5.00,0.00,65.00,");
  });

  it("keeps the federal summary exactly as before (no DT or Exempt columns)", async () => {
    mockCreateClient.mockResolvedValue(makeClient(tenHourWeek()) as any);
    const lines = (await (await GET(req("from=2026-06-08&to=2026-06-14&format=summary"))).text()).split("\n");
    expect(lines[0]).toBe("Employee,Week Of,Regular Hrs,OT Hrs,Break Hrs,Total Hrs,Incomplete");
    expect(lines[1]).toBe("Ann,2026-06-08,40.00,10.00,0.00,50.00,");
  });

  it("writes Double Time IIF lines and declares the type", async () => {
    mockCreateClient.mockResolvedValue(makeClient(laWeek(13), CA) as any);
    const iif = (await (await GET(req("from=2026-06-08&to=2026-06-14&format=qb-iif"))).text()).split("\n");
    expect(iif).toContain("TIMETYPE\tDouble Time");
    const monday = iif.filter((l) => l.startsWith("TIMEACT\t06/08/2026")).map((l) => l.split("\t").slice(4, 6).join("|"));
    expect(monday).toEqual(["Regular Time|8.00", "Overtime|4.00", "Double Time|1.00"]);
  });

  it("doesn't declare Double Time in IIF when nobody has any", async () => {
    mockCreateClient.mockResolvedValue(makeClient(tenHourWeek()) as any);
    const iif = await (await GET(req("from=2026-06-08&to=2026-06-14&format=qb-iif"))).text();
    expect(iif).not.toContain("Double Time");
  });

  it("shows DT and the 7th day in the breakdown", async () => {
    const punches = laWeek(6);
    for (const d of ["13", "14"]) {
      const start = Date.parse(`2026-06-${d}T13:00:00.000Z`);
      punches.push(p("clock_in", new Date(start).toISOString()), p("clock_out", new Date(start + 10 * 3_600_000).toISOString()));
    }
    mockCreateClient.mockResolvedValue(makeClient(punches, CA) as any);
    const text = await (await GET(req("from=2026-06-08&to=2026-06-14&format=detailed"))).text();
    const lines = text.split("\n");
    expect(lines[0]).toBe("Employee,Week Of,Date,Day,Worked Hrs,Cumulative Wk Hrs,Regular Hrs,OT Hrs,DT Hrs,Break Hrs,Incomplete,7th Day");
    // Sunday is the 7th consecutive day: 8 OT + 2 DT.
    expect(text).toContain("Ann,2026-06-08,2026-06-14,Sun,10.00,50.00,0.00,8.00,2.00,0.00,,Yes");
  });

  it("marks exempt employees and gives them no overtime", async () => {
    const punches = [...tenHourWeek(1, "Ann"), ...tenHourWeek(2, "Ben")];
    mockCreateClient.mockResolvedValue(makeClient(punches, { exemptIds: [1] }) as any);
    const summary = (await (await GET(req("from=2026-06-08&to=2026-06-14&format=summary"))).text()).split("\n");
    expect(summary[0]).toBe("Employee,Week Of,Regular Hrs,OT Hrs,Break Hrs,Total Hrs,Incomplete,Exempt");
    expect(summary[1]).toBe("Ann,2026-06-08,50.00,0.00,0.00,50.00,,Yes");
    expect(summary[2]).toBe("Ben,2026-06-08,40.00,10.00,0.00,50.00,,");
    mockCreateClient.mockResolvedValue(makeClient(punches, { exemptIds: [1] }) as any);
    const daily = (await (await GET(req("from=2026-06-08&to=2026-06-14&format=daily"))).text()).split("\n");
    expect(daily[0]).toBe("Employee,Date,Day,Hours Worked,Break Hours,Incomplete,Exempt");
    expect(daily[1]).toBe("Ann,2026-06-08,Mon,10.00,0.00,,Yes");
    mockCreateClient.mockResolvedValue(makeClient(punches, { exemptIds: [1] }) as any);
    const iif = (await (await GET(req("from=2026-06-08&to=2026-06-14&format=qb-iif"))).text()).split("\n");
    const ann = iif.filter((l) => l.includes("\tAnn\t"));
    expect(ann.every((l) => l.split("\t")[4] === "Regular Time" && l.split("\t")[6] === "Exempt")).toBe(true);
  });

  it("uses the org's workweek start for weeks and the query window", async () => {
    const client = makeClient(tenHourWeek(), { settings: [{ key: "payroll_week_start", value: "3" }] });
    mockCreateClient.mockResolvedValue(client as any);
    const lines = (await (await GET(req("from=2026-06-08&to=2026-06-14&format=summary"))).text()).split("\n");
    // Wednesday weeks: Mon–Tue belong to the week of Jun 3, Wed–Fri to Jun 10.
    expect(lines.slice(1, 3)).toEqual(["Ann,2026-06-03,20.00,0.00,0.00,20.00,", "Ann,2026-06-10,30.00,0.00,0.00,30.00,"]);
    expect(client.calls.find((c) => c.table === "punch_records")!.gte).toBe("2026-06-02T04:00:00.000Z");
  });

  it("rounds punches with rounding on", async () => {
    const punches = [p("clock_in", "2026-06-08T13:07:00.000Z"), p("clock_out", "2026-06-08T21:08:00.000Z")];
    mockCreateClient.mockResolvedValue(makeClient(punches, { settings: [{ key: "punch_rounding_minutes", value: "15" }] }) as any);
    const lines = (await (await GET(req("from=2026-06-08&to=2026-06-14&format=summary"))).text()).split("\n");
    expect(lines[1]).toBe("Ann,2026-06-08,8.25,0.00,0.00,8.25,");
  });

  it("refuses non-managers", async () => {
    mockCreateClient.mockResolvedValue(makeClient(tenHourWeek(), { isManager: false }) as any);
    expect((await GET(req("from=2026-06-08&to=2026-06-14&format=summary"))).status).toBe(403);
    mockCreateClient.mockResolvedValue(makeClient(tenHourWeek(), { isManager: false }) as any);
    expect((await GET_REPORT(new Request("http://localhost/api/reports/payroll?from=2026-06-08&to=2026-06-14"))).status).toBe(403);
  });

  it("returns the rules and exempt flags from the report endpoint", async () => {
    mockCreateClient.mockResolvedValue(makeClient(laWeek(13), { ...CA, exemptIds: [1] }) as any);
    const body = await (await GET_REPORT(new Request("http://localhost/api/reports/payroll?from=2026-06-08&to=2026-06-14"))).json();
    expect(body.rules).toMatchObject({ overtimeRule: "california", workweekStartDay: 1, roundingMinutes: 0 });
    expect(body.rows[0]).toMatchObject({ exempt: true, totalRegularHours: 65, totalOvertimeHours: 0, totalDoubleTimeHours: 0 });
  });
});
