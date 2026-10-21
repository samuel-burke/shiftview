import { describe, it, expect, vi } from "vitest";
import { GET } from "./route";
import { createClient } from "@/lib/supabase-server";
import { makeQueryBuilder, makeSupabaseClient, MOCK_ORG_ID, MOCK_USER } from "../__tests__/helpers";

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

// Monday Oct 12 – Sunday Oct 18, 2026; 9 AM – 6 PM EDT (13:00–22:00 UTC)
// Monday to Friday is 45 hours: 40 regular, 5 overtime.
const WEEK = "from=2026-10-12&to=2026-10-18";
const PUNCHES = ["12", "13", "14", "15", "16"].flatMap((d, i) => [
  { id: i * 2 + 1, punch_type: "clock_in", punched_at: `2026-10-${d}T13:00:00Z`, is_manual: false, note: null },
  { id: i * 2 + 2, punch_type: "clock_out", punched_at: `2026-10-${d}T22:00:00Z`, is_manual: false, note: null },
]);

// The client from makeSupabaseClient, with punch_records answering page by
// page (fetchAllRows reads until an empty page) and every other table empty.
// `settings`: app_settings rows. `exemptIds`: what the exempt-employee lookup
// (employees, paged) returns. `punches` replaces PUNCHES. `callouts`: what the
// callouts_for_org RPC returns (null data with `calloutError` to fail it).
function client(
  opts: Parameters<typeof makeSupabaseClient>[0],
  {
    settings = [] as { key: string; value: string }[], exemptIds = [] as number[], punches = PUNCHES as any[],
    callouts = [] as { date: string; reason: string | null }[], calloutError = null as any,
  } = {},
) {
  const base = makeSupabaseClient({ queryData: [], ...opts });
  base.rpc.mockImplementation(() => makeQueryBuilder({ data: calloutError ? null : callouts, error: calloutError }));
  const baseFrom = base.from.getMockImplementation()!;
  const punchQueries: Array<Record<string, any>> = [];
  const exemptQueries: Array<Record<string, any>> = [];
  base.from.mockImplementation((table: string) => {
    if (table === "app_settings") return makeQueryBuilder({ data: settings, error: null });
    if (table === "employees") {
      const b = baseFrom(table);
      b.range = vi.fn((first: number) => {
        exemptQueries.push(b);
        return makeQueryBuilder({ data: first === 0 ? exemptIds.map((id) => ({ id })) : [], error: null });
      });
      return b;
    }
    if (table !== "punch_records") return baseFrom(table);
    const b = makeQueryBuilder({ data: punches, error: null });
    punchQueries.push(b);
    b.range = vi.fn((first: number) => makeQueryBuilder({ data: first === 0 ? punches : [], error: null }));
    return b;
  });
  return { supabase: base, punchQueries, exemptQueries };
}

const req = (qs: string) => new Request(`http://localhost/api/timecard?${qs}`);

describe("GET /api/timecard", () => {
  it("returns 401 when signed out", async () => {
    mockCreateClient.mockResolvedValue(client({ user: null }).supabase as any);
    const res = await GET(req(`employeeId=5&${WEEK}`));
    expect(res.status).toBe(401);
  });

  describe("an employee", () => {
    const alex = { id: 5, name: "Alex Kim" };

    it("gets their own time card without naming themselves, with overtime split as payroll does", async () => {
      const { supabase, punchQueries } = client({ user: MOCK_USER, linkedEmployee: alex });
      mockCreateClient.mockResolvedValue(supabase as any);
      const res = await GET(req(WEEK));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.employeeId).toBe(5);
      expect(body.totalWorkedHours).toBe(45);
      expect(body.days).toHaveLength(5);
      expect(body.weeks).toEqual([
        expect.objectContaining({ weekStart: "2026-10-12", regularHours: 40, overtimeHours: 5, totalWorkedHours: 45 }),
      ]);
      // Scoped to the caller, whatever else the request said.
      expect(punchQueries[0].eq).toHaveBeenCalledWith("employee_id", 5);
      // No pay data in the response.
      expect(JSON.stringify(body)).not.toMatch(/pay_?rate/i);
      // Default rules: federal, Monday workweek, exact time.
      expect(body.exempt).toBe(false);
      expect(body.payRules).toEqual({ overtimeRule: "federal", workweekStartDay: 1, roundingMinutes: 0 });
    });

    it("gets their own time card when they name themselves", async () => {
      const { supabase } = client({ user: MOCK_USER, linkedEmployee: alex });
      mockCreateClient.mockResolvedValue(supabase as any);
      const res = await GET(req(`employeeId=5&${WEEK}`));
      expect(res.status).toBe(200);
      expect((await res.json()).employeeId).toBe(5);
    });

    it("is refused another employee's time card", async () => {
      const { supabase, punchQueries } = client({ user: MOCK_USER, linkedEmployee: alex });
      mockCreateClient.mockResolvedValue(supabase as any);
      const res = await GET(req(`employeeId=6&${WEEK}`));
      expect(res.status).toBe(403);
      expect(punchQueries).toHaveLength(0);
    });

    it("sees their own exempt flag, looked up for them only", async () => {
      const { supabase, exemptQueries } = client({ user: MOCK_USER, linkedEmployee: alex }, { exemptIds: [5] });
      mockCreateClient.mockResolvedValue(supabase as any);
      const body = await (await GET(req(WEEK))).json();
      expect(body.exempt).toBe(true);
      expect(body.weeks[0].overtimeHours).toBe(0);
      expect(exemptQueries[0].eq).toHaveBeenCalledWith("id", 5);
    });

    it("is refused another employee's CSV too", async () => {
      const { supabase } = client({ user: MOCK_USER, linkedEmployee: alex });
      mockCreateClient.mockResolvedValue(supabase as any);
      const res = await GET(req(`employeeId=6&${WEEK}&format=csv`));
      expect(res.status).toBe(403);
    });
  });

  describe("a manager", () => {
    it("reads any employee in the org", async () => {
      const { supabase, punchQueries } = client({
        user: MOCK_USER,
        isManager: true,
        linkedEmployee: { id: 6, name: "Bo Diaz" },
      });
      mockCreateClient.mockResolvedValue(supabase as any);
      const res = await GET(req(`employeeId=6&${WEEK}`));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.employeeId).toBe(6);
      expect(body.employeeName).toBe("Bo Diaz");
      expect(body.weeks[0]).toMatchObject({ overtimeHours: 5 });
      expect(punchQueries[0].eq).toHaveBeenCalledWith("employee_id", 6);
    });

    it("must name the employee", async () => {
      const { supabase } = client({ user: MOCK_USER, isManager: true, linkedEmployee: { id: 6, name: "Bo Diaz" } });
      mockCreateClient.mockResolvedValue(supabase as any);
      const res = await GET(req(WEEK));
      expect(res.status).toBe(400);
    });

    it("gets the org's pay rules applied: exempt employees get no overtime", async () => {
      const { supabase, exemptQueries } = client(
        { user: MOCK_USER, isManager: true, linkedEmployee: { id: 6, name: "Bo Diaz" } },
        { exemptIds: [6] },
      );
      mockCreateClient.mockResolvedValue(supabase as any);
      const body = await (await GET(req(`employeeId=6&${WEEK}`))).json();
      expect(body.exempt).toBe(true);
      expect(body.weeks[0]).toMatchObject({ regularHours: 45, overtimeHours: 0, doubleTimeHours: 0 });
      // Only this employee is looked up, in this org.
      expect(exemptQueries[0].eq).toHaveBeenCalledWith("id", 6);
      expect(exemptQueries[0].eq).toHaveBeenCalledWith("org_id", expect.any(String));
    });

    it("splits by the org's overtime rule and workweek start", async () => {
      // 9h a day under California: 1h daily overtime each day, no weekly OT.
      const { supabase, punchQueries } = client(
        { user: MOCK_USER, isManager: true, linkedEmployee: { id: 6, name: "Bo Diaz" } },
        { settings: [{ key: "overtime_rule", value: "california" }, { key: "payroll_week_start", value: "0" }] },
      );
      mockCreateClient.mockResolvedValue(supabase as any);
      const body = await (await GET(req(`employeeId=6&${WEEK}`))).json();
      expect(body.exempt).toBe(false);
      expect(body.payRules).toEqual({ overtimeRule: "california", workweekStartDay: 0, roundingMinutes: 0 });
      // Sunday workweek: Oct 11 is the week start; the query starts the day before (EDT).
      expect(punchQueries[0].gte).toHaveBeenCalledWith("punched_at", "2026-10-10T04:00:00.000Z");
      expect(body.weeks).toEqual([
        expect.objectContaining({ weekStart: "2026-10-11", regularHours: 40, overtimeHours: 5, doubleTimeHours: 0 }),
      ]);
      expect(body.weeks[0].days.map((d: any) => d.overtimeHours)).toEqual([1, 1, 1, 1, 1]);
    });

    it("shows raw and rounded punch times with rounding on", async () => {
      const punches = [
        { id: 1, punch_type: "clock_in", punched_at: "2026-10-12T13:07:00Z", is_manual: false, note: null },
        { id: 2, punch_type: "clock_out", punched_at: "2026-10-12T21:08:00Z", is_manual: false, note: null },
      ];
      const { supabase } = client(
        { user: MOCK_USER, isManager: true, linkedEmployee: { id: 6, name: "Bo Diaz" } },
        { settings: [{ key: "punch_rounding_minutes", value: "15" }], punches },
      );
      mockCreateClient.mockResolvedValue(supabase as any);
      const body = await (await GET(req(`employeeId=6&${WEEK}`))).json();
      expect(body.days[0].punches.map((p: any) => [p.punchedAt, p.roundedAt])).toEqual([
        ["2026-10-12T13:07:00Z", "2026-10-12T13:00:00.000Z"],
        ["2026-10-12T21:08:00Z", "2026-10-12T21:15:00.000Z"],
      ]);
      expect(body.days[0].workedHours).toBe(8.02);
      expect(body.days[0].roundedWorkedHours).toBe(8.25);
      expect(body.weeks[0].totalWorkedHours).toBe(8.25); // payroll pays the rounded time
    });

    it("gets 404 for an employee outside the org", async () => {
      const { supabase } = client({ user: MOCK_USER, isManager: true, linkedEmployee: null });
      mockCreateClient.mockResolvedValue(supabase as any);
      const res = await GET(req(`employeeId=99&${WEEK}`));
      expect(res.status).toBe(404);
    });
  });

  describe("pay periods and sign-off", () => {
    const settings = [
      { key: "timezone", value: "America/New_York" },
      { key: "pay_period_frequency", value: "weekly" },
    ];
    const periodRow = {
      id: 9, start_date: "2026-10-12", end_date: "2026-10-18", status: "approved",
      approved_at: "2026-10-19T13:00:00Z", locked_at: null,
    };

    it("no pay periods: payPeriods is empty", async () => {
      const { supabase } = client({ user: MOCK_USER, isManager: true, linkedEmployee: { id: 6, name: "Bo Diaz" } });
      mockCreateClient.mockResolvedValue(supabase as any);
      expect((await (await GET(req(`employeeId=6&${WEEK}`))).json()).payPeriods).toEqual([]);
    });

    it("shows the period's status and this employee's sign-off, queried for that employee only", async () => {
      const signoffBuilders: any[] = [];
      const { supabase } = client({
        user: MOCK_USER,
        isManager: true,
        linkedEmployee: { id: 6, name: "Bo Diaz" },
        tableOverrides: { pay_periods: { data: [periodRow], error: null } },
      }, { settings });
      const prev = supabase.from.getMockImplementation()!;
      supabase.from.mockImplementation((table: string) => {
        if (table !== "pay_period_signoffs") return prev(table);
        const b = makeQueryBuilder({
          data: [{ period_id: 9, employee_id: 6, status: "disputed", note: "Missing Friday", signed_at: "2026-10-18T23:00:00Z" }],
          error: null,
        });
        signoffBuilders.push(b);
        return b;
      });
      mockCreateClient.mockResolvedValue(supabase as any);
      const body = await (await GET(req(`employeeId=6&${WEEK}`))).json();
      expect(body.payPeriods).toEqual([{
        start: "2026-10-12", end: "2026-10-18", status: "approved",
        signoff: { employeeId: 6, status: "disputed", note: "Missing Friday", signedAt: "2026-10-18T23:00:00Z" },
      }]);
      expect(signoffBuilders[0].eq).toHaveBeenCalledWith("employee_id", 6);
    });

    it("an unsigned, untouched period is open with no sign-off", async () => {
      const { supabase } = client({
        user: MOCK_USER,
        linkedEmployee: { id: 5, name: "Alex Kim" },
        tableOverrides: { pay_periods: { data: [], error: null } },
      }, { settings });
      mockCreateClient.mockResolvedValue(supabase as any);
      const body = await (await GET(req(WEEK))).json();
      expect(body.payPeriods).toEqual([{ start: "2026-10-12", end: "2026-10-18", status: "open", signoff: null }]);
    });
  });
  // Reasons are private to the employee and managers (migration 0076): read
  // through callouts_for_org, never the callouts table directly.
  describe("private callout reasons", () => {
    const manager = { user: MOCK_USER, isManager: true, linkedEmployee: { id: 6, name: "Bo Diaz" } };
    const flu = { callouts: [{ date: "2026-10-12", reason: "Flu" }] };

    it("keeps reasons in the manager's time card using the scoped RPC", async () => {
      const { supabase } = client(manager, flu);
      mockCreateClient.mockResolvedValue(supabase as any);
      const res = await GET(req(`employeeId=6&${WEEK}`));
      expect(res.status).toBe(200);
      expect((await res.json()).days[0].callout).toEqual({ reason: "Flu" });
      expect(supabase.rpc).toHaveBeenCalledWith("callouts_for_org", { p_org: MOCK_ORG_ID });
      expect(supabase.from).not.toHaveBeenCalledWith("callouts");
    });

    it("keeps the employee's own reason on their time card", async () => {
      const { supabase } = client({ user: MOCK_USER, linkedEmployee: { id: 5, name: "Alex Kim" } }, flu);
      mockCreateClient.mockResolvedValue(supabase as any);
      const res = await GET(req(WEEK));
      expect(res.status).toBe(200);
      expect((await res.json()).days[0].callout).toEqual({ reason: "Flu" });
    });

    it("preserves reasons in CSV exports", async () => {
      const { supabase } = client(manager, flu);
      mockCreateClient.mockResolvedValue(supabase as any);
      const res = await GET(req(`employeeId=6&${WEEK}&format=csv`));
      expect(res.status).toBe(200);
      expect(await res.text()).toContain("Flu");
    });

    it("fails the request when the private read fails", async () => {
      const { supabase } = client(manager, { calloutError: { message: "read failed" } });
      mockCreateClient.mockResolvedValue(supabase as any);
      expect((await GET(req(`employeeId=6&${WEEK}`))).status).toBe(500);
    });
  });
});
