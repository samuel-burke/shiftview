import { describe, it, expect, vi } from "vitest";
import { GET } from "./route";
import { createClient } from "@/lib/supabase-server";
import { MOCK_USER, MOCK_ORG_ID } from "../../__tests__/helpers";

vi.mock("@/lib/supabase-server", () => ({ createClient: vi.fn() }));
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

// Every table serves `rows[table]`, paged by .range() (at most `cap` rows a
// page, like the API's max-rows cap); an error per table can be set.
function makeClient({
  user = MOCK_USER as any,
  isManager = true,
  rows = {} as Record<string, any[]>,
  errors = {} as Record<string, any>,
  rpc = {} as Record<string, any>,
  cap = 1000,
} = {}) {
  const managerRow = isManager && user ? { user_id: user.id, org_id: MOCK_ORG_ID, is_owner: false } : null;
  const builder = (table: string) => {
    const b: any = {};
    for (const m of ["select", "insert", "update", "delete", "upsert", "eq", "neq", "gte", "lte", "gt", "lt", "order", "or", "limit", "in"])
      b[m] = vi.fn().mockReturnValue(b);
    const data = () =>
      table === "managers" ? (managerRow ? [managerRow] : [])
        : table === "app_settings" ? [{ key: "timezone", value: "America/New_York" }]
          : rows[table] ?? [];
    b.range = vi.fn((from: number, to: number) =>
      Promise.resolve(errors[table] ? { data: null, error: errors[table] } : { data: data().slice(from, Math.min(to + 1, from + cap)), error: null })
    );
    b.maybeSingle = vi.fn().mockResolvedValue({ data: table === "managers" ? managerRow : null, error: null });
    b.single = b.maybeSingle;
    b.then = (resolve: any, reject: any) =>
      Promise.resolve(errors[table] ? { data: null, error: errors[table] } : { data: data(), error: null }).then(resolve, reject);
    return b;
  };
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: vi.fn().mockImplementation(builder),
    rpc: vi.fn((fn: string) => Promise.resolve(rpc[fn] ?? { data: [], error: null })),
  };
}

const req = (weekStart?: string) =>
  new Request(
    weekStart
      ? `http://localhost/api/reports/labor-cost?weekStart=${weekStart}`
      : "http://localhost/api/reports/labor-cost"
  );

const rate = (employee_id: number, effective_from: string, hourly_rate: number | string | null, position_id: number | null = null) =>
  ({ id: Math.random(), employee_id, position_id, effective_from, hourly_rate });

let nextId = 1;
// A punched shift on a Mon–Sun EDT date: local start/end hours (end may pass 24).
function punched(employee_id: number, date: string, startH: number, endH: number, name = `Emp ${employee_id}`, schedule_id: number | null = null) {
  const startMs = Date.parse(`${date}T00:00:00Z`) + (startH + 4) * 3_600_000;
  const endMs = Date.parse(`${date}T00:00:00Z`) + (endH + 4) * 3_600_000;
  return [
    { id: nextId++, employee_id, schedule_id, punch_type: "clock_in", punched_at: new Date(startMs).toISOString(), employees: { name } },
    { id: nextId++, employee_id, schedule_id: null, punch_type: "clock_out", punched_at: new Date(endMs).toISOString(), employees: { name } },
  ];
}

describe("GET /api/reports/labor-cost", () => {
  it("returns 400 when weekStart is missing or malformed", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    expect((await GET(req())).status).toBe(400);
    expect((await GET(req("nope"))).status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ user: null }) as any);
    expect((await GET(req("2026-07-06"))).status).toBe(401);
  });

  it("returns 403 for a non-manager, and reads no rates", async () => {
    const c = makeClient({ isManager: false, rows: { employee_pay_rates: [rate(1, "1900-01-01", 20)] } });
    mockCreateClient.mockResolvedValue(c as any);
    expect((await GET(req("2026-07-06"))).status).toBe(403);
    expect(c.from).not.toHaveBeenCalledWith("employee_pay_rates");
    expect(c.from).not.toHaveBeenCalledWith("punch_records");
  });

  it("computes per-employee and total scheduled cost with overtime at 1.5x", async () => {
    // Emp 1: 5 × 9h = 45h. Emp 2: 1 × 8h = 8h.
    const schedules = [
      ...["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10"].map((date, i) => ({
        id: i + 1, date, employee_id: 1, start_minutes: 480, end_minutes: 1020, position_id: null,
      })),
      { id: 9, date: "2026-07-06", employee_id: 2, start_minutes: 480, end_minutes: 960, position_id: null },
    ];
    mockCreateClient.mockResolvedValue(
      makeClient({
        rows: {
          schedules,
          employees: [{ id: 1, name: "Alex P" }, { id: 2, name: "Jordan K" }],
          employee_pay_rates: [rate(1, "1900-01-01", 20), rate(2, "1900-01-01", "15.00")],
        },
      }) as any
    );
    const res = await GET(req("2026-07-06"));
    expect(res.status).toBe(200);
    const body = await res.json();

    const alex = body.employees.find((e: any) => e.employeeId === 1);
    expect(alex.cost).toBe(950); // 40×20 + 5×20×1.5
    expect(alex.payRate).toBe(20);
    expect(alex.employeeName).toBe("Alex P");
    const jordan = body.employees.find((e: any) => e.employeeId === 2);
    expect(jordan.cost).toBe(120); // 8×15

    expect(body.totalCost).toBe(1070);
    expect(body.employeesMissingRate).toBe(0);
    expect(body.days.map((d: any) => d.scheduledCost)).toEqual([300, 180, 180, 180, 230, 0, 0]);
  });

  it("costs scheduled days at the rate in effect on each date", async () => {
    const schedules = ["2026-07-06", "2026-07-07", "2026-07-08"].map((date, i) => ({
      id: i + 1, date, employee_id: 1, start_minutes: 480, end_minutes: 960, position_id: null,
    }));
    mockCreateClient.mockResolvedValue(makeClient({
      rows: { schedules, employee_pay_rates: [rate(1, "1900-01-01", 15), rate(1, "2026-07-08", 20)] },
    }) as any);
    const body = await (await GET(req("2026-07-06"))).json();
    expect(body.days.slice(0, 3).map((d: any) => d.scheduledCost)).toEqual([120, 120, 160]);
    expect(body.totalCost).toBe(400);
  });

  it("flags scheduled employees with no pay rate set", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        rows: {
          schedules: [{ id: 1, date: "2026-07-06", employee_id: 3, start_minutes: 480, end_minutes: 960 }],
          employees: [{ id: 3, name: "Sam B" }],
        },
      }) as any
    );
    const body = await (await GET(req("2026-07-06"))).json();
    expect(body.employeesMissingRate).toBe(1);
    expect(body.employees[0].cost).toBeNull();
  });

  it("returns 500 when pay rates can't be read", async () => {
    mockCreateClient.mockResolvedValue(
      makeClient({
        rows: { schedules: [{ id: 1, date: "2026-07-06", employee_id: 3, start_minutes: 480, end_minutes: 960 }] },
        errors: { employee_pay_rates: { code: "42501", message: "boom" } },
      }) as any
    );
    expect((await GET(req("2026-07-06"))).status).toBe(500);
  });

  it("returns an empty summary when nothing is scheduled or punched", async () => {
    mockCreateClient.mockResolvedValue(makeClient() as any);
    const body = await (await GET(req("2026-07-06"))).json();
    expect(body.employees).toEqual([]);
    expect(body.totalCost).toBe(0);
    expect(body.actual).toEqual({ totalCost: 0, employeesMissingRate: 0, hasIncomplete: false, employees: [] });
    expect(body.days).toHaveLength(7);
  });

  it("reports actual cost from punches next to scheduled cost, per day and week", async () => {
    // Scheduled 8h Mon; worked 9h Mon and 10h Tue, raise from $20 to $25 on Tue.
    mockCreateClient.mockResolvedValue(makeClient({
      rows: {
        schedules: [{ id: 1, date: "2026-07-06", employee_id: 1, start_minutes: 480, end_minutes: 960, position_id: null }],
        punch_records: [...punched(1, "2026-07-06", 8, 17, "Alex P"), ...punched(1, "2026-07-07", 8, 18, "Alex P")],
        employee_pay_rates: [rate(1, "1900-01-01", 20), rate(1, "2026-07-07", 25)],
      },
    }) as any);
    const body = await (await GET(req("2026-07-06"))).json();
    expect(body.days[0]).toEqual({ date: "2026-07-06", scheduledCost: 160, actualCost: 180 });
    expect(body.days[1]).toEqual({ date: "2026-07-07", scheduledCost: 0, actualCost: 250 });
    expect(body.actual.totalCost).toBe(430);
    expect(body.actual.employees).toEqual([{
      employeeId: 1, employeeName: "Alex P", regularHours: 19, overtimeHours: 0, doubleTimeHours: 0, totalHours: 19,
      cost: 430, missingRate: false, hasIncomplete: false,
      days: { "2026-07-06": 180, "2026-07-07": 250, "2026-07-08": 0, "2026-07-09": 0, "2026-07-10": 0, "2026-07-11": 0, "2026-07-12": 0 },
    }]);
  });

  it("prices actual overtime at 1.5x, counting hours before a Saturday week start", async () => {
    // Schedule week Sat Jul 11 – Fri Jul 17. Mon–Fri Jul 6–10 were 40h (payroll
    // workweek starts Monday), so Saturday's 5h are overtime.
    const punches = [
      ...["2026-07-06", "2026-07-07", "2026-07-08", "2026-07-09", "2026-07-10"].flatMap((d) => punched(1, d, 8, 16)),
      ...punched(1, "2026-07-11", 8, 13),
    ];
    mockCreateClient.mockResolvedValue(makeClient({
      rows: { punch_records: punches, employee_pay_rates: [rate(1, "1900-01-01", 20)] },
    }) as any);
    const body = await (await GET(req("2026-07-11"))).json();
    expect(body.actual.employees[0]).toMatchObject({ overtimeHours: 5, regularHours: 0, cost: 150 });
    expect(body.days[0].actualCost).toBe(150);
  });

  it("pays a position's own rate for a shift in that position", async () => {
    mockCreateClient.mockResolvedValue(makeClient({
      rows: {
        punch_records: punched(1, "2026-07-06", 8, 16, "Alex P", 44),
        schedules: [{ id: 44, date: "2026-07-06", employee_id: 1, start_minutes: 480, end_minutes: 960, position_id: 2 }],
        employee_pay_rates: [rate(1, "1900-01-01", 20), rate(1, "1900-01-01", 30, 2)],
      },
    }) as any);
    const body = await (await GET(req("2026-07-06"))).json();
    expect(body.actual.totalCost).toBe(240);
    expect(body.totalCost).toBe(240); // scheduled in the same position
  });

  it("flags actual hours with no rate", async () => {
    mockCreateClient.mockResolvedValue(makeClient({ rows: { punch_records: punched(1, "2026-07-06", 8, 16) } }) as any);
    const body = await (await GET(req("2026-07-06"))).json();
    expect(body.actual.employeesMissingRate).toBe(1);
    expect(body.actual.employees[0].cost).toBeNull();
  });

  it("pages past the API's row cap", async () => {
    const punches = ["2026-07-06", "2026-07-07", "2026-07-08"].flatMap((d) => [...punched(1, d, 8, 16), ...punched(2, d, 8, 16)]);
    mockCreateClient.mockResolvedValue(makeClient({
      rows: { punch_records: punches, employee_pay_rates: [rate(1, "1900-01-01", 10), rate(2, "1900-01-01", 10)] },
      cap: 3,
    }) as any);
    const body = await (await GET(req("2026-07-06"))).json();
    expect(body.actual.totalCost).toBe(480);
  });
});
