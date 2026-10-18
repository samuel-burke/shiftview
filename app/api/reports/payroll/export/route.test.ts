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
  { cap = 1000, tz = "America/New_York", tables = {} as Record<string, any[]>, rpc = {} as Record<string, any>, isManager = true } = {},
) {
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
        : table === "app_settings" ? [{ key: "timezone", value: tz }] : tables[table] ?? [];
    b.range = vi.fn((from: number, to: number) => {
      calls.push({ ...filters });
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
    rpc: vi.fn((fn: string) => Promise.resolve(rpc[fn] ?? { data: null, error: null })),
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
    expect(lines[1]).toBe("Ann,,2026-06-08,10.00,10.00,0.00,20.00,,,,,,Yes");
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
    expect(timeacts.some((l) => ["0.00", "0:00"].includes(l.split("\t")[5]))).toBe(false);
  });

  it("splits a QuickBooks day that crosses 40h into regular and overtime lines", async () => {
    mockCreateClient.mockResolvedValue(makeClient(tenHourWeek()) as any);
    const iif = await (await GET(req("from=2026-06-08&to=2026-06-14&format=qb-iif"))).text();
    const lines = iif.split("\n").filter((l) => l.startsWith("TIMEACT\t")).map((l) => l.split("\t").slice(1, 6).join("|"));
    expect(lines).toEqual([
      "06/08/2026||Ann|Regular Time|10:00",
      "06/09/2026||Ann|Regular Time|10:00",
      "06/10/2026||Ann|Regular Time|10:00",
      "06/11/2026||Ann|Regular Time|10:00",
      "06/12/2026||Ann|Overtime|10:00",
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

describe("GET /api/reports/payroll/export — rates, payroll IDs and presets", () => {
  // Ann: raise from $20 to $30 on Fri Jun 12 (her overtime day); payroll ID G-1.
  const rateRows = [
    { id: 1, employee_id: 1, position_id: null, effective_from: "1900-01-01", hourly_rate: "20.00" },
    { id: 2, employee_id: 1, position_id: null, effective_from: "2026-06-12", hourly_rate: "30.00" },
  ];
  const client = (opts: Parameters<typeof makeClient>[1] = {}) =>
    makeClient(tenHourWeek(), {
      tables: { employee_pay_rates: rateRows },
      rpc: { employee_payroll_ids: { data: [{ employee_id: 1, payroll_id: "G-1" }], error: null } },
      ...opts,
    });

  it("refuses an employee (403) and reads nothing", async () => {
    const c = client({ isManager: false });
    mockCreateClient.mockResolvedValue(c as any);
    const res = await GET(req("from=2026-06-08&to=2026-06-14&format=summary"));
    expect(res.status).toBe(403);
    expect(c.from).not.toHaveBeenCalledWith("employee_pay_rates");
    expect(c.rpc).not.toHaveBeenCalled();
  });

  it("pays the summary at the rate in effect each day, with the payroll ID", async () => {
    mockCreateClient.mockResolvedValue(client() as any);
    const lines = (await (await GET(req("from=2026-06-08&to=2026-06-14&format=summary"))).text()).split("\n");
    expect(lines[0]).toBe(
      "Employee,Payroll ID,Week Of,Regular Hrs,OT Hrs,Break Hrs,Total Hrs,Incomplete,Regular Pay,OT Pay,Double Time Pay,Total Pay,Missing Rate"
    );
    // 40h × $20 + 10h overtime × $30 × 1.5.
    expect(lines[1]).toBe("Ann,G-1,2026-06-08,40.00,10.00,0.00,50.00,,800.00,450.00,0.00,1250.00,");
  });

  it("writes the daily rate and dollars", async () => {
    mockCreateClient.mockResolvedValue(client() as any);
    const lines = (await (await GET(req("from=2026-06-08&to=2026-06-14&format=daily"))).text()).split("\n");
    expect(lines[4]).toBe("Ann,G-1,2026-06-11,Thu,,10.00,0.00,10.00,0.00,0.00,20.00,200.00,0.00,0.00,200.00,");
    expect(lines[5]).toBe("Ann,G-1,2026-06-12,Fri,,10.00,0.00,0.00,10.00,0.00,30.00,0.00,450.00,0.00,450.00,");
  });

  it("uses the position of the shift each punch was clocked in for", async () => {
    const punches = tenHourWeek().map((x) => (x.punch_type === "clock_in" ? { ...x, schedule_id: 90 } : x));
    const c = makeClient(punches, {
      tables: {
        employee_pay_rates: [...rateRows, { id: 3, employee_id: 1, position_id: 5, effective_from: "1900-01-01", hourly_rate: "25.00" }],
        schedules: [{ id: 90, position_id: 5 }],
        positions: [{ id: 5, name: "Shift Lead" }],
      },
    });
    mockCreateClient.mockResolvedValue(c as any);
    const lines = (await (await GET(req("from=2026-06-08&to=2026-06-14&format=daily"))).text()).split("\n");
    expect(lines[1]).toBe("Ann,,2026-06-08,Mon,Shift Lead,10.00,0.00,10.00,0.00,0.00,25.00,250.00,0.00,0.00,250.00,");
  });

  it("exports the Gusto preset", async () => {
    mockCreateClient.mockResolvedValue(client() as any);
    const res = await GET(req("from=2026-06-08&to=2026-06-14&format=gusto"));
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="gusto_hours_2026-06-08_to_2026-06-14.csv"');
    expect((await res.text()).split("\n")).toEqual([
      "Employee ID,Last name,First name,Regular hours,Overtime hours,Double overtime hours,Workweeks",
      "G-1,,Ann,40.00,10.00,0.00,2026-06-08 - 2026-06-14",
    ]);
  });

  it("exports the ADP preset with the company code, and refuses one without it", async () => {
    mockCreateClient.mockResolvedValue(client() as any);
    expect((await GET(req("from=2026-06-08&to=2026-06-14&format=adp"))).status).toBe(400);
    expect((await GET(req("from=2026-06-08&to=2026-06-14&format=adp&coCode=ab"))).status).toBe(400);
    const res = await GET(req("from=2026-06-08&to=2026-06-14&format=adp&coCode=k9z"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="PRK9ZEPI.csv"');
    expect((await res.text()).split("\n")).toEqual([
      "Co Code,Batch ID,File #,Temp Dept,Temp Rate,Reg Hours,O/T Hours,Hours 3 Code,Hours 3 Amount",
      "K9Z,260614,G-1,,,40.00,10.00,,",
    ]);
  });

  it("exports the QuickBooks Online preset", async () => {
    mockCreateClient.mockResolvedValue(client() as any);
    const lines = (await (await GET(req("from=2026-06-08&to=2026-06-14&format=qbo"))).text()).split("\n");
    expect(lines[0]).toBe("Date,Employee,Service Item,Duration,Hourly Rate,Billable,Description");
    expect(lines[1]).toBe("06/08/2026,Ann,Regular Time,10:00,20.00,No,");
    expect(lines[5]).toBe("06/12/2026,Ann,Overtime,10:00,45.00,No,");
  });

  it("falls back to the summary for an unknown format, as before", async () => {
    mockCreateClient.mockResolvedValue(client() as any);
    const res = await GET(req("from=2026-06-08&to=2026-06-14&format=nope"));
    expect(res.status).toBe(200);
    expect((await res.text()).startsWith("Employee,Payroll ID,Week Of")).toBe(true);
  });

  it("returns 500 when the rates can't be read", async () => {
    const c = client();
    const original = c.from.getMockImplementation()!;
    c.from.mockImplementation((table: string) => {
      const b = original(table);
      if (table === "employee_pay_rates") b.range = vi.fn().mockResolvedValue({ data: null, error: { code: "42501" } });
      return b;
    });
    mockCreateClient.mockResolvedValue(c as any);
    expect((await GET(req("from=2026-06-08&to=2026-06-14&format=summary"))).status).toBe(500);
  });

  it("still exports before migration 0061, at the single current rate", async () => {
    const c = makeClient(tenHourWeek(), {
      rpc: {
        employee_pay_rates: { data: [{ employee_id: 1, pay_rate: "10" }], error: null },
        employee_payroll_ids: { data: null, error: { code: "PGRST202" } },
      },
    });
    const original = c.from.getMockImplementation()!;
    c.from.mockImplementation((table: string) => {
      const b = original(table);
      if (table === "employee_pay_rates") b.range = vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST205" } });
      return b;
    });
    mockCreateClient.mockResolvedValue(c as any);
    const lines = (await (await GET(req("from=2026-06-08&to=2026-06-14&format=summary"))).text()).split("\n");
    expect(lines[1]).toBe("Ann,,2026-06-08,40.00,10.00,0.00,50.00,,400.00,150.00,0.00,550.00,");
  });
});
